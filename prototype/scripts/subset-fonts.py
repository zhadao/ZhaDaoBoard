"""把阿里巴巴普惠体按「GB2312 常用汉字 + 拉丁 + 常用符号」子集化并转成 woff2。

用法：python subset-fonts.py <源字体> <输出.woff2>
由 scripts/build-fonts.mjs 调用（见该文件的降级逻辑）。
"""

import os
import sys

from fontTools import subset


def unicode_set():
    """GB2312 全量汉字 + ASCII/拉丁 + 中英标点 + 常用符号。"""
    codepoints = set()

    # GB2312：覆盖 6763 个常用汉字与常用标点，够个人白板使用
    for high in range(0xA1, 0xFF):
        for low in range(0xA1, 0xFF):
            try:
                char = bytes([high, low]).decode("gb2312")
            except UnicodeDecodeError:
                continue
            codepoints.add(ord(char))

    ranges = [
        (0x0020, 0x007E),  # ASCII
        (0x00A0, 0x00FF),  # Latin-1 补充
        (0x0100, 0x017F),  # 拉丁扩展 A
        (0x0180, 0x024F),  # 拉丁扩展 B
        (0x0370, 0x03FF),  # 希腊字母（数学公式常用）
        (0x0400, 0x04FF),  # 西里尔字母
        (0x2000, 0x206F),  # 通用标点
        (0x2070, 0x209F),  # 上下标
        (0x20A0, 0x20BF),  # 货币符号
        (0x2100, 0x214F),  # 字母式符号
        (0x2150, 0x218F),  # 数字形式
        (0x2190, 0x21FF),  # 箭头
        (0x2200, 0x22FF),  # 数学运算符
        (0x2300, 0x23FF),  # 杂项技术符号
        (0x2460, 0x24FF),  # 带圈字母数字
        (0x2500, 0x257F),  # 制表符
        (0x2580, 0x259F),  # 方块元素
        (0x25A0, 0x25FF),  # 几何图形
        (0x2600, 0x26FF),  # 杂项符号
        (0x2700, 0x27BF),  # 装饰符号
        (0x3000, 0x303F),  # CJK 标点
        (0x3105, 0x312F),  # 注音符号
        (0x31C0, 0x31EF),  # CJK 笔画
        (0x3200, 0x32FF),  # 带圈 CJK
        (0x3300, 0x33FF),  # CJK 兼容
        (0x4E00, 0x9FFF),  # CJK 统一表意文字（补 GB2312 未覆盖的常用字）
        (0xF900, 0xFAFF),  # CJK 兼容表意文字
        (0xFE10, 0xFE1F),  # 竖排标点
        (0xFE30, 0xFE4F),  # CJK 兼容标点
        (0xFF00, 0xFFEF),  # 半角及全角形式
    ]
    for start, end in ranges:
        codepoints.update(range(start, end + 1))

    return codepoints


def main():
    if len(sys.argv) != 3:
        print("用法：python subset-fonts.py <源字体> <输出.woff2>", file=sys.stderr)
        return 2

    source, target = sys.argv[1], sys.argv[2]
    if not os.path.isfile(source):
        print(f"源字体不存在：{source}", file=sys.stderr)
        return 1

    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.notdef_outline = True
    options.recalc_bounds = True
    options.hinting = False
    options.drop_tables += ["DSIG"]

    font = subset.load_font(source, options)
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=unicode_set())
    subsetter.subset(font)

    os.makedirs(os.path.dirname(os.path.abspath(target)), exist_ok=True)
    subset.save_font(font, target, options)
    font.close()

    size = os.path.getsize(target)
    print(f"{os.path.basename(target)}: {size / 1024 / 1024:.2f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
