import type { RefObject } from "react";

/**
 * 点阵背景层：夹在画布容器底色与引擎画布之间（引擎画布被设为透明）。
 * 位置与点距由 useDotGrid 通过 CSS 变量驱动，这里只负责挂载节点。
 */
export function DotGrid({
  layerRef,
  enabled,
}: {
  layerRef: RefObject<HTMLDivElement>;
  enabled: boolean;
}) {
  return (
    <div
      ref={layerRef}
      className="wb-dotgrid"
      data-enabled={enabled ? "true" : "false"}
      data-dense="false"
      aria-hidden="true"
    />
  );
}
