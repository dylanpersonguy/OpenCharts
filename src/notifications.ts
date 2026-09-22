import { toast, type ToastPayload } from "./services/toast.ts";

/**
 * Terminal notifications — order fills, rejections and their reasons,
 * validation warnings — as a stream a host can consume.
 *
 * Use it to route messages into your own notification system; pair it with
 * `<OpenChartsProvider showNotifications={false}>` to turn the built-in ones
 * off.
 *
 * ```ts
 * const stop = onNotification((n) => myToaster.show(n.title, n.message, n.type));
 * ```
 */
export type Notification = ToastPayload;

export function onNotification(listener: (notification: Notification) => void): () => void {
  return toast.subscribe(listener);
}
