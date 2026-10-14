/** 相对时间格式化：刚刚 / N 分钟前 / 今天 HH:mm / 昨天 HH:mm / YYYY-MM-DD */
export function formatTime(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const min = 60 * 1000;
  const hour = 60 * min;
  const day = 24 * hour;

  if (diff < min) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / min)} 分钟前`;

  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  if (ts >= startOfToday.getTime()) return `今天 ${hh}:${mm}`;
  if (ts >= startOfToday.getTime() - day) return `昨天 ${hh}:${mm}`;

  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${dd}`;
}

/** 生成带 hash 的完整 URL，便于「在新标签页打开」 */
export function boardUrl(id: string): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#/board/${id}`;
}
