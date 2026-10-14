import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createShortcut,
  parseShortcut,
  idListToPath,
  readIdList,
  ITEM_TYPE,
} from "../scripts/make-shortcut.mjs";

/** 每个用例在自己的临时目录里造文件，跑完就删干净。 */
function withTempDir(fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wb-shortcut-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * LinkInfo 在文件里的起点。
 *
 * **不能写死 76**：头之后先是 LinkTargetIDList（头 76 + 2 字节长度字段 + IDListSize），
 * LinkInfo 才跟在后面。第一版测试就是因为写死 76 而在补上 IDList 之后静默失效 ——
 * 断言读到的其实是 IDList 里的字节，却"看起来"像在验 LinkInfo。
 */
function linkInfoOffset(buf) {
  const flags = buf.readUInt32LE(20);
  let at = 76;
  if (flags & 0x1) at += 2 + buf.readUInt16LE(at);
  return at;
}

test("快捷方式：写出来的字节能被解析回原样的目标路径", () => {
  withTempDir((dir) => {
    const target = path.join(dir, "WhiteBoard.exe");
    writeFileSync(target, "stub");
    const link = path.join(dir, "白板.lnk");

    const info = createShortcut(link, target, { name: "白板 · 本地无限画布" });
    assert.ok(info.bytes > 76, "文件长度应大于头长度");

    const parsed = parseShortcut(link);
    assert.equal(parsed.linkInfo.localBasePath, target);
    assert.equal(parsed.linkInfo.commonPathSuffix, "");
    assert.equal(parsed.strings.relativePath, "WhiteBoard.exe");
    assert.equal(parsed.strings.workingDir, dir);
    assert.equal(parsed.strings.iconLocation, target);
    assert.equal(parsed.strings.name, "白板 · 本地无限画布");
    assert.equal(parsed.trailingBytes, 0, "不应有未消费的尾部字节");
  });
});

test("快捷方式：ShellLinkHeader 的固定字段符合规范", () => {
  withTempDir((dir) => {
    const target = path.join(dir, "WhiteBoard.exe");
    const link = path.join(dir, "a.lnk");
    createShortcut(link, target);

    const buf = readFileSync(link);
    assert.equal(buf.readUInt32LE(0), 0x4c, "HeaderSize 必须是 0x4C");
    assert.equal(
      buf.subarray(4, 20).toString("hex"),
      "0114020000000000c000000000000046",
      "LinkCLSID 必须是 ShellLink"
    );
    assert.equal(buf.readUInt32LE(56), 1, "ShowCommand 应为 SW_SHOWNORMAL");
    assert.equal(buf.readUInt16LE(60), 0, "HotKey 应为 0");

    const flags = buf.readUInt32LE(20);
    // 必须写 IDList：第一版只写 LinkInfo，Windows 双击直接弹
    // 「该文件没有与之关联的应用来执行该操作」。这条断言就是为了钉死它别再退回去。
    assert.ok(flags & 0x1, "必须置 HasLinkTargetIDList");
    assert.ok(flags & 0x2, "必须置 HasLinkInfo");
    assert.ok(flags & 0x8, "必须置 HasRelativePath");
    assert.ok(flags & 0x10, "必须置 HasWorkingDir");
    assert.ok(flags & 0x40, "必须置 HasIconLocation");
    assert.ok(flags & 0x80, "必须置 IsUnicode");
  });
});

test("快捷方式：LinkTargetIDList 能逐项还原出目标路径", () => {
  withTempDir((dir) => {
    const target = path.join(dir, "WhiteBoard.exe");
    const link = path.join(dir, "c.lnk");
    createShortcut(link, target);

    const buf = readFileSync(link);
    const list = readIdList(buf, 76);

    // 长度字段自述的字节数必须和"头之后到 LinkInfo 之前"完全对上
    assert.equal(76 + list.bytes, linkInfoOffset(buf), "IDList 长度与 LinkInfo 起点必须自洽");

    const kinds = list.items.map((item) => item.kind);
    assert.equal(kinds[0], "root", "第一项必须是「我的电脑」根");
    assert.equal(kinds[1], "volume", "第二项必须是驱动器");
    assert.equal(kinds.at(-1), "file", "最后一项必须是目标文件");
    assert.ok(kinds.slice(2, -1).every((kind) => kind === "directory"), "中间各项必须是目录");

    assert.equal(list.items[1].driveRoot, path.parse(target).root);
    assert.equal(list.items.at(-1).longName, "WhiteBoard.exe");
    assert.equal(idListToPath(list.items), target, "IDList 还原出的路径必须与目标一致");
  });
});

test("快捷方式：LinkInfo 内部偏移自洽（VolumeID → LocalBasePath → 空后缀）", () => {
  withTempDir((dir) => {
    const target = path.join(dir, "WhiteBoard.exe");
    const link = path.join(dir, "b.lnk");
    createShortcut(link, target);

    const buf = readFileSync(link);
    const at = linkInfoOffset(buf);
    const size = buf.readUInt32LE(at);
    const headerSize = buf.readUInt32LE(at + 4);
    const flags = buf.readUInt32LE(at + 8);
    const volumeIdOffset = buf.readUInt32LE(at + 12);
    const localBasePathOffset = buf.readUInt32LE(at + 16);
    const networkOffset = buf.readUInt32LE(at + 20);
    const suffixOffset = buf.readUInt32LE(at + 24);

    assert.equal(headerSize, 0x1c);
    assert.equal(flags, 0x1, "必须是 VolumeIDAndLocalBasePath");
    assert.equal(volumeIdOffset, headerSize, "VolumeID 紧跟头");
    assert.ok(localBasePathOffset > volumeIdOffset);
    assert.equal(networkOffset, 0, "没有网络路径");
    assert.ok(suffixOffset > localBasePathOffset);
    assert.ok(at + size <= buf.length, "LinkInfoSize 不得越界");

    // VolumeID 自述的尺寸必须和下一个字段的起点对得上
    const volumeIdSize = buf.readUInt32LE(at + volumeIdOffset);
    assert.equal(volumeIdOffset + volumeIdSize, localBasePathOffset);
    // 目标路径必须以 NUL 结尾，且紧跟空后缀
    assert.equal(buf[at + suffixOffset - 1], 0, "LocalBasePath 必须以 NUL 结尾");
  });
});

test("快捷方式：非 ASCII 目标路径明确报错，而不是写出一个坏快捷方式", () => {
  withTempDir((dir) => {
    const target = path.join(dir, "白板目录", "WhiteBoard.exe");
    const link = path.join(dir, "中文.lnk");
    assert.throws(
      () => createShortcut(link, target),
      /非 ASCII/,
      "中文路径必须被拦住 —— IDList 主名与 LocalBasePath 都是 ANSI 字段，写出去就是乱码，"
        + "而乱码的 .lnk 在 Windows 上表现为「该文件没有与之关联的应用来执行该操作」"
    );
  });
});

test("快捷方式：ASCII 路径里的中文快捷方式名走 UTF-16，不受路径限制影响", () => {
  withTempDir((dir) => {
    const target = path.join(dir, "WhiteBoard.exe");
    const link = path.join(dir, "白板.lnk");
    createShortcut(link, target, { name: "白板 · 本地无限画布" });
    const parsed = parseShortcut(link);
    assert.equal(parsed.strings.name, "白板 · 本地无限画布");
    assert.equal(parsed.idList[0].type, ITEM_TYPE.ROOT);
  });
});
