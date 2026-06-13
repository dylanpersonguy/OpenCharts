import { request } from "./request";

// Inline types to avoid dist-build dependency during tsc --noEmit
interface AnnouncementsListResponse {
  announcements: {
    id: string;
    firmId: string;
    createdBy: string;
    authorName: string;
    title: string;
    body: string;
    imageData?: string | null;
    publishedAt: string;
    createdAt: string;
    isRead: boolean;
  }[];
  unreadCount: number;
  total: number;
}

interface CreateAnnouncementInput {
  title: string;
  body: string;
  imageData?: string | null;
}

export const announcementsApi = {
  // ── Trader ──
  getAnnouncements: (page = 1, limit = 20) =>
    request<AnnouncementsListResponse>(`/announcements?page=${page}&limit=${limit}`),

  getAnnouncementsUnreadCount: () =>
    request<{ unreadCount: number }>("/announcements/unread-count"),

  markAnnouncementRead: (id: string) =>
    request<{ read: boolean }>(`/announcements/${id}/read`, { method: "POST" }),

  markAllAnnouncementsRead: () =>
    request<{ markedRead: number }>("/announcements/read-all", { method: "POST" }),
};

export const adminAnnouncementsApi = {
  // ── Admin ──
  createAnnouncement: (input: CreateAnnouncementInput) =>
    request<any>("/admin/announcements", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  getAdminAnnouncements: (page = 1, limit = 20) =>
    request<any>(`/admin/announcements?page=${page}&limit=${limit}`),

  deleteAnnouncement: (id: string) =>
    request<{ deleted: boolean }>(`/admin/announcements/${id}`, { method: "DELETE" }),
};
