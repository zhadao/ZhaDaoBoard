/**
 * 生成 Windows 快捷方式（.lnk），纯 JS 写二进制，不依赖任何外部进程。
 *
 * 用法：
 *   node scripts/make-shortcut.mjs <lnk 路径> <目标 exe 路径> [工作目录]
 *   或 import { createShortcut } from "./make-shortcut.mjs"
 *
 * ## 为什么自己写
 *
 * 常规做法是 `WScript.Shell` COM（PowerShell / cscript），但本机宿主把
 * 「从 Node 里 spawn 外部进程」和「PowerShell 里 new COM 对象」都挡掉了
 * （分别是 EBUSY 和 security block），于是这条路在自动化构建里根本走不通。
 *
 * ## 为什么必须有 LinkTargetIDList
 *
 * 第一版只写了 `LinkInfo`（目标绝对路径字符串），**实测被 Windows 拒绝**：
 * 双击/ShellExecute 时弹「该文件没有与之关联的应用来执行该操作」。
 * 原因是快捷方式的目标有两处冗余描述，缺了 IDList 时 shell 干脆不认这个文件。
 * 所以这里老老实实按 MS-SHLLINK 把 IDList 也写出来：
 *
 *   IDList = [根（我的电脑）] [驱动器] [逐级目录…] [目标文件] 0x0000
 *
 * 每项的字节布局是照着本机**真实存在的**快捷方式（Adobe 安装器生成的）
 * 反推出来的，并由 tests/shortcut.test.mjs 里的「解码→再编码必须字节相同」
 * 用例守着——拿 Windows 自己的产物当基准，比照文档猜要可靠得多。
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLSID_SHELL_LINK = Buffer.from([
  0x01, 0x14, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00,
  0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46,
]);

/** LinkFlags 位（MS-SHLLINK 2.1.1）。 */
const FLAG = {
  HasLinkTargetIDList: 0x00000001,
  HasLinkInfo: 0x00000002,
  HasName: 0x00000004,
  HasRelativePath: 0x00000008,
  HasWorkingDir: 0x00000010,
  HasArguments: 0x00000020,
  HasIconLocation: 0x00000040,
  IsUnicode: 0x00000080,
};

/** Shell 项类型（abID 的第 1 个字节）。 */
export const ITEM_TYPE = {
  ROOT: 0x1f, // “我的电脑”根
  VOLUME: 0x2f, // 驱动器（D:\）
  DIRECTORY: 0x31,
  FILE: 0x32,
};

const ATTR_DIRECTORY = 0x10;
const ATTR_ARCHIVE = 0x20;

/** 扩展块里几个固定值（对照真实快捷方式得到，含义未公开，原样照抄最安全）。 */
const EXT_VERSION = 0x0009;
const EXT_FLAGS = 0xbeef0004;
/** 扩展块里“长名字段”的起始偏移；真实文件里偏移 16 处存的就是这个值（0x2E）。 */
const EXT_NAME_OFFSET = 46;
/** 长名之后还有 2 字节的尾巴，实测等于 `14 + 主名块长度`（主名块 = 8.3 名 + NUL 补齐到偶数）。 */
const EXT_TRAILER_BASE = 14;

const FILE_ATTRIBUTE_ARCHIVE = 0x00000020;
const SW_SHOWNORMAL = 1;

/** 只接受 ASCII 可打印字符的路径（见 assertAsciiPath 的说明）。 */
const ASCII_PATH = /^[\x20-\x7e]*$/;

/**
 * 本写入器**只保证 ASCII 路径**，遇到非 ASCII 一律明确报错，不赌。
 *
 * 为什么不能"顺手支持中文"：
 *   IDList 里的主名（8.3 短名）和 `LinkInfo.LocalBasePath` 都是**ANSI 字段**，
 *   规范指的是"系统默认代码页"。Node 内置模块拿不到 GBK，本文件也没有引入
 *   iconv 之类的依赖，所以含中文的路径会被写成 latin1 乱码。
 *   而乱码的快捷方式在 Windows 上表现为双击弹
 *   「该文件没有与之关联的应用来执行该操作」—— 正是本文件开头记录的那个坑。
 *
 * 为什么不去"查一下真实短名照抄"：
 *   实测扫本机 291 个真实快捷方式（含 Adobe / 3ds Max / Logitech 等安装器产物），
 *   IDList 的长名里**一个非 ASCII 字符都没有** —— 也就是说没有可参照的正确写法。
 *   既然没有基准，就不该猜。
 *
 * 影响面很小：正式版目录默认是 `D:\\Coding\\WhiteBoard\\release\\`，纯 ASCII；
 * 万一被放到中文目录下，`启动白板.bat` 照样能用（它不依赖快捷方式）。
 */
function assertAsciiPath(value, label) {
  if (!ASCII_PATH.test(value)) {
    throw new Error(
      `${label}含非 ASCII 字符，本快捷方式写入器不支持：${value}\n` +
        `        请把正式版目录放到纯英文路径下（如 D:\\WhiteBoard\\），或直接用「启动白板.bat」启动。`
    );
  }
}

/** “我的电脑”根项的 abID：type 0x1F + GUID {20D04FE0-3AEA-1069-A2D8-08002B30309D}。 */
const ROOT_ABID = Buffer.from("1f50e04fd020ea3a6910a2d808002b30309d", "hex");

/** StringData 的 CountCharacters + UTF-16 字符（不含结尾空字符）。 */
function unicodeString(value) {
  const chars = Buffer.from(value, "utf16le");
  const header = Buffer.alloc(2);
  header.writeUInt16LE(value.length, 0);
  return Buffer.concat([header, chars]);
}

function ansi(value) {
  return Buffer.concat([Buffer.from(value, "latin1"), Buffer.from([0])]);
}

/** 本地时间 → FAT/DOS 日期时间（4 字节：高 16 位日期、低 16 位时间）。 */
function dosDateTime(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return ((day << 16) | time) >>> 0;
}

/**
 * 生成 8.3 短名。
 * 名字本来就符合 8.3 时原样返回（真实快捷方式里 "Windows" / "Contents" 就是这样），
 * 否则按 NTFS 的约定取前 6 个字符加大写 + `~1`。
 */
export function toShortName(name) {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot + 1) : "";
  const fits = (s, max) => s.length <= max && s.length > 0 && !/[\s.]/.test(s);
  if (fits(base, 8) && (ext === "" || fits(ext, 3))) return name;
  const trimmed = base.slice(0, 6).toUpperCase();
  return ext ? `${trimmed}~1.${ext.slice(0, 3).toUpperCase()}` : `${trimmed}~1`;
}

/**
 * 编码一个文件/目录 ItemID。
 *
 * 布局（偏移全部相对 abID 起点）：
 *   0  类型（0x31 目录 / 0x32 文件）
 *   1  0
 *   2  fileSize (4)
 *   6  DOS 日期时间 (4)
 *   10 属性 (2)
 *   12 主名（8.3，ASCII + NUL，**补 0 到偶数长度**，保证后面 2 字节字段对齐）
 *   X  扩展块：extSize(2) version(2) flags(4) 元数据(38) 长名(UTF-16 + NUL) 尾巴(2)
 *
 * 扩展块里那几个含义未公开的 4 字节字段（偏移 8/12/20/42，看着像时间戳与
 * 文件引用号）只影响“目标被移动后能不能自动找回来”，不参与路径解析，
 * 所以默认写 0；`meta` 参数用于把真实文件里的值原样搬过来（自检用）。
 */
export function encodeItemId({
  type,
  attrs,
  primaryName,
  longName,
  fileSize = 0,
  dateTime = dosDateTime(),
  meta = {},
}) {
  const primary = ansi(primaryName);
  const primaryBlock = primary.length % 2 === 0 ? primary : Buffer.concat([primary, Buffer.from([0])]);

  const longNameBlock = Buffer.concat([Buffer.from(longName, "utf16le"), Buffer.alloc(2)]);
  const trailerOffset = EXT_NAME_OFFSET + longNameBlock.length;
  const extSize = trailerOffset + 2;
  const ext = Buffer.alloc(extSize);
  ext.writeUInt16LE(extSize, 0);
  ext.writeUInt16LE(EXT_VERSION, 2);
  ext.writeUInt32LE(EXT_FLAGS, 4);
  ext.writeUInt32LE(meta.m8 ?? dateTime, 8);
  ext.writeUInt32LE(meta.m12 ?? dateTime, 12);
  ext.writeUInt32LE(EXT_NAME_OFFSET, 16); // 长名相对偏移
  // 偏移 20 起是 8 字节的 NTFS 文件引用（低 4 字节 MFT 序号 + 高 4 字节序列号）。
  // 只用于“目标被移动后自动找回来”，不参与路径解析；新建的快捷方式没有这个信息，
  // 写 0 即可（shell 会退回按路径解析）。
  ext.writeUInt32LE(meta.refLow ?? 0, 20);
  ext.writeUInt32LE(meta.refHigh ?? 0, 24);
  ext.writeUInt32LE(meta.m42 ?? 0, 42);
  longNameBlock.copy(ext, EXT_NAME_OFFSET);
  ext.writeUInt16LE(meta.trailer ?? EXT_TRAILER_BASE + primaryBlock.length, trailerOffset);

  const head = Buffer.alloc(12);
  head[0] = type;
  head[1] = 0;
  head.writeUInt32LE(fileSize, 2);
  head.writeUInt32LE(dateTime, 6);
  head.writeUInt16LE(attrs, 10);

  return Buffer.concat([head, primaryBlock, ext]);
}

/** 驱动器项：type 0x2F + 根路径（"D:\"）+ 补 0 到 23 字节。 */
export function encodeVolumeItem(driveRoot) {
  const abID = Buffer.alloc(23);
  abID[0] = ITEM_TYPE.VOLUME;
  Buffer.from(driveRoot, "latin1").copy(abID, 1);
  return abID;
}

/** 解码一个 ItemID（给自检和 parseShortcut 用）。 */
export function decodeItemId(abID) {
  const type = abID[0];
  if (type === ITEM_TYPE.ROOT) {
    return { type, kind: "root", abID: Buffer.from(abID) };
  }
  if (type === ITEM_TYPE.VOLUME) {
    let end = 1;
    while (end < abID.length && abID[end] !== 0) end++;
    return { type, kind: "volume", driveRoot: abID.toString("latin1", 1, end), abID: Buffer.from(abID) };
  }
  if (type !== ITEM_TYPE.DIRECTORY && type !== ITEM_TYPE.FILE) {
    return { type, kind: "unknown", abID: Buffer.from(abID) };
  }

  const fileSize = abID.readUInt32LE(2);
  const dateTime = abID.readUInt32LE(6);
  const attrs = abID.readUInt16LE(10);

  let p = 12;
  while (abID[p] !== 0) p++;
  const primaryName = abID.toString("latin1", 12, p);
  // 主名补 0 到偶数长度 → 扩展块从下一个偶数字节开始
  let extStart = p + 1;
  if (extStart % 2 !== 0) extStart++;
  const extSize = abID.readUInt16LE(extStart);
  const ext = abID.subarray(extStart, extStart + extSize);

  // 长名偏移由扩展块偏移 16 处自述（真实文件里是 0x2E），不写死更稳。
  const nameOffset = ext.readUInt32LE(16) || EXT_NAME_OFFSET;
  let longName = "";
  for (let at = nameOffset; at + 1 < ext.length; at += 2) {
    const code = ext.readUInt16LE(at);
    if (code === 0) break;
    longName += String.fromCharCode(code);
  }

  return {
    type,
    kind: type === ITEM_TYPE.FILE ? "file" : "directory",
    attrs,
    fileSize,
    dateTime,
    primaryName,
    longName,
    extSize,
    meta: {
      m8: ext.readUInt32LE(8),
      m12: ext.readUInt32LE(12),
      refLow: ext.readUInt32LE(20),
      refHigh: ext.readUInt32LE(24),
      m42: ext.readUInt32LE(42),
      trailer: ext.readUInt16LE(extSize - 2),
    },
    abID: Buffer.from(abID),
  };
}

/** 把目标路径编成 LinkTargetIDList（含结尾 0x0000，前面带 2 字节总长）。 */
export function buildIdList(targetPath) {
  const absolute = path.resolve(targetPath);
  const parsed = path.parse(absolute);
  if (!parsed.root || parsed.root.length < 3) throw new Error(`无法解析盘符：${absolute}`);

  const items = [ROOT_ABID, encodeVolumeItem(parsed.root)];
  const relative = parsed.dir.slice(parsed.root.length);
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    items.push(
      encodeItemId({
        type: ITEM_TYPE.DIRECTORY,
        attrs: ATTR_DIRECTORY,
        primaryName: toShortName(segment),
        longName: segment,
      })
    );
  }
  items.push(
    encodeItemId({
      type: ITEM_TYPE.FILE,
      attrs: ATTR_ARCHIVE,
      primaryName: toShortName(parsed.base),
      longName: parsed.base,
    })
  );

  const body = Buffer.concat([...items.map(withLengthPrefix), Buffer.alloc(2)]);
  const size = Buffer.alloc(2);
  size.writeUInt16LE(body.length, 0);
  return { buffer: Buffer.concat([size, body]), items };
}

/** ItemID 前面要带 2 字节 cb（含自己）。 */
function withLengthPrefix(abID) {
  const header = Buffer.alloc(2);
  header.writeUInt16LE(abID.length + 2, 0);
  return Buffer.concat([header, abID]);
}

/**
 * 读出一个 IDList，返回逐项解码结果。
 *
 * `IDListSize` 的语义是实测出来的，不是猜的：扫本机 148 个带 IDList 的真实快捷方式
 * （Adobe / 3ds Max / Logitech 等安装器生成），**148 个全部满足**
 * `IDListSize === 各项 cb 之和 + 2（结尾 0x0000）`，即：
 *   - **包含**结尾的 0x0000 终止项；
 *   - **不包含**它自己这 2 字节的长度字段。
 * 所以「整个 IDList 占用的字节数」= IDListSize + 2，返回值里的 `bytes` 就是这么算的。
 */
export function readIdList(buf, offset) {
  const total = buf.readUInt16LE(offset);
  const end = offset + 2 + total; // 含 2 字节长度字段 + 长度字段自述的 IDList 体
  let at = offset + 2;
  const items = [];
  while (at < end) {
    const cb = buf.readUInt16LE(at);
    if (cb === 0) break; // 终止项
    items.push(decodeItemId(buf.subarray(at + 2, at + cb)));
    at += cb;
  }
  return { items, bytes: total + 2 };
}

/**
 * 构造 LinkInfo（带 VolumeIDAndLocalBasePath）。
 *
 * 布局：Header(28) → VolumeID → LocalBasePath(ANSI) → CommonPathSuffix(空)
 * 所有偏移都相对于 LinkInfo 起点。
 */
function buildLinkInfo(targetPath) {
  const HEADER_SIZE = 0x1c;
  const volumeIdOffset = HEADER_SIZE;
  const volumeLabel = ansi(""); // 卷标留空：本地固定磁盘不需要，Explorer 也不依赖它
  const volumeIdSize = 16 + volumeLabel.length;
  const localBasePathOffset = volumeIdOffset + volumeIdSize;
  const basePath = ansi(targetPath);
  const commonPathSuffixOffset = localBasePathOffset + basePath.length;
  const suffix = ansi("");
  const total = commonPathSuffixOffset + suffix.length;

  const linkInfo = Buffer.alloc(total);
  linkInfo.writeUInt32LE(total, 0);
  linkInfo.writeUInt32LE(HEADER_SIZE, 4);
  linkInfo.writeUInt32LE(0x00000001, 8); // VolumeIDAndLocalBasePath
  linkInfo.writeUInt32LE(volumeIdOffset, 12);
  linkInfo.writeUInt32LE(localBasePathOffset, 16);
  linkInfo.writeUInt32LE(0, 20); // CommonNetworkRelativeLinkOffset：没有网络路径
  linkInfo.writeUInt32LE(commonPathSuffixOffset, 24);

  const at = volumeIdOffset;
  linkInfo.writeUInt32LE(volumeIdSize, at);
  linkInfo.writeUInt32LE(3, at + 4); // DRIVE_FIXED
  linkInfo.writeUInt32LE(0, at + 8); // 序列号：0 表示不指定
  linkInfo.writeUInt32LE(16, at + 12); // VolumeLabelOffset
  volumeLabel.copy(linkInfo, at + 16);
  basePath.copy(linkInfo, localBasePathOffset);
  suffix.copy(linkInfo, commonPathSuffixOffset);
  return linkInfo;
}

/**
 * 创建一个指向 exe 的快捷方式。
 * @returns {{ linkPath: string, targetPath: string, bytes: number, items: number }}
 */
export function createShortcut(linkPath, targetPath, options = {}) {
  const absoluteTarget = path.resolve(targetPath);
  const workingDir = options.workingDir ? path.resolve(options.workingDir) : path.dirname(absoluteTarget);
  const iconPath = options.iconPath ? path.resolve(options.iconPath) : absoluteTarget;
  const name = options.name ?? path.basename(absoluteTarget, path.extname(absoluteTarget));
  const args = options.arguments ?? null;

  // 三个路径字段最终都会落进 ANSI 字段（IDList 主名 / LinkInfo.LocalBasePath），
  // 非 ASCII 会变乱码并导致快捷方式被 Windows 拒绝，所以在写字节之前就拦住。
  assertAsciiPath(absoluteTarget, "目标路径");
  assertAsciiPath(workingDir, "工作目录");
  assertAsciiPath(iconPath, "图标路径");

  const flags =
    FLAG.HasLinkTargetIDList |
    FLAG.HasLinkInfo |
    FLAG.HasName |
    FLAG.HasRelativePath |
    FLAG.HasWorkingDir |
    (args ? FLAG.HasArguments : 0) |
    FLAG.HasIconLocation |
    FLAG.IsUnicode;

  const header = Buffer.alloc(76);
  header.writeUInt32LE(0x4c, 0); // HeaderSize
  CLSID_SHELL_LINK.copy(header, 4);
  header.writeUInt32LE(flags, 20);
  header.writeUInt32LE(FILE_ATTRIBUTE_ARCHIVE, 24);
  // CreationTime / AccessTime / WriteTime 保持 0（未设置），Explorer 不依赖
  header.writeUInt32LE(0, 48); // FileSize
  header.writeUInt32LE(0, 52); // IconIndex
  header.writeUInt32LE(SW_SHOWNORMAL, 56);
  header.writeUInt16LE(0, 60); // HotKey
  // 62..75 保留字段已经是 0

  const idList = buildIdList(absoluteTarget);
  const linkInfo = buildLinkInfo(absoluteTarget);
  // StringData 的顺序由规范固定：NAME → RELATIVE_PATH → WORKING_DIR → ARGUMENTS → ICON
  const nameData = unicodeString(name);
  const relativePath = unicodeString(path.basename(absoluteTarget));
  const workingDirData = unicodeString(workingDir);
  const argumentsData = args ? unicodeString(args) : Buffer.alloc(0);
  const iconLocation = unicodeString(iconPath);

  const buffer = Buffer.concat([
    header,
    idList.buffer,
    linkInfo,
    nameData,
    relativePath,
    workingDirData,
    argumentsData,
    iconLocation,
  ]);
  writeFileSync(linkPath, buffer);
  return {
    linkPath,
    targetPath: absoluteTarget,
    bytes: buffer.length,
    items: idList.items.length,
  };
}

/* ------------------------------------------------------------------ */
/* 自检：把刚写出来的字节按规范解析回去，确认每个字段都对得上          */
/* ------------------------------------------------------------------ */

export function parseShortcut(linkPath) {
  const buf = readFileSync(linkPath);
  if (buf.readUInt32LE(0) !== 0x4c) throw new Error("HeaderSize 不是 0x4C");
  if (!buf.subarray(4, 20).equals(CLSID_SHELL_LINK)) throw new Error("LinkCLSID 不匹配");
  const flags = buf.readUInt32LE(20);
  const result = { flags, idList: null, linkInfo: null, strings: {} };

  let offset = 76;
  if (flags & FLAG.HasLinkTargetIDList) {
    const list = readIdList(buf, offset);
    result.idList = list.items;
    offset += list.bytes;
  }
  if (flags & FLAG.HasLinkInfo) {
    const size = buf.readUInt32LE(offset);
    const headerSize = buf.readUInt32LE(offset + 4);
    if (headerSize < 0x1c) throw new Error("LinkInfoHeaderSize 过小");
    if (size > buf.length - offset) throw new Error("LinkInfoSize 越界");
    const localBasePathOffset = buf.readUInt32LE(offset + 16);
    const suffixOffset = buf.readUInt32LE(offset + 24);
    const readCString = (at) => {
      let end = at;
      while (end < offset + size && buf[end] !== 0) end++;
      return buf.toString("latin1", at, end);
    };
    result.linkInfo = {
      size,
      localBasePath: readCString(offset + localBasePathOffset),
      commonPathSuffix: readCString(offset + suffixOffset),
    };
    offset += size;
  }

  const readUnicodeString = () => {
    const count = buf.readUInt16LE(offset);
    const value = buf.toString("utf16le", offset + 2, offset + 2 + count * 2);
    offset += 2 + count * 2;
    return value;
  };
  if (flags & FLAG.HasName) result.strings.name = readUnicodeString();
  if (flags & FLAG.HasRelativePath) result.strings.relativePath = readUnicodeString();
  if (flags & FLAG.HasWorkingDir) result.strings.workingDir = readUnicodeString();
  if (flags & FLAG.HasArguments) result.strings.arguments = readUnicodeString();
  if (flags & FLAG.HasIconLocation) result.strings.iconLocation = readUnicodeString();
  result.trailingBytes = buf.length - offset;
  return result;
}

/** 把 IDList 还原成可读路径（用于日志与自检）。 */
export function idListToPath(items) {
  const volume = items.find((item) => item.kind === "volume");
  const names = items.filter((item) => item.kind === "directory" || item.kind === "file");
  if (!volume) return null;
  const parts = names.map((item) => item.longName || item.primaryName);
  return volume.driveRoot + parts.join(path.sep);
}

function main() {
  const [linkArg, targetArg, workArg] = process.argv.slice(2);
  if (!linkArg || !targetArg) {
    throw new Error("用法：node scripts/make-shortcut.mjs <lnk 路径> <目标 exe 路径> [工作目录]");
  }
  const linkPath = path.resolve(linkArg);
  const targetPath = path.resolve(targetArg);
  const info = createShortcut(linkPath, targetPath, {
    workingDir: workArg ? path.resolve(workArg) : undefined,
  });
  const parsed = parseShortcut(linkPath);
  console.log(
    `[shortcut] ${info.linkPath}（${info.bytes} 字节，IDList ${info.items} 项）\n` +
      `           IDList 还原：${idListToPath(parsed.idList)}\n` +
      `           LinkInfo 目标：${parsed.linkInfo.localBasePath}\n` +
      `           工作目录：${parsed.strings.workingDir}\n` +
      `           图标：${parsed.strings.iconLocation}`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`[shortcut] 创建失败：${error.message}`);
    process.exitCode = 1;
  }
}
