import { request } from "./request";

type JsonMap = Record<string, unknown>;

export type LegalDocument = {
  id: string;
  slug: string;
  title: string;
  version?: string;
  category?: string;
  publishedAt?: string;
  [key: string]: unknown;
};

export type LegalDocumentContent = {
  id: string;
  slug: string;
  title: string;
  content: string;
  version?: string;
  [key: string]: unknown;
};

export type ConsentRecord = {
  id: string;
  consentType: string;
  status: string;
  grantedAt?: string;
  withdrawnAt?: string;
  documentId?: string;
  [key: string]: unknown;
};

export type DataRequestRecord = {
  id: string;
  requestType: string;
  status: string;
  reason?: string;
  createdAt?: string;
  [key: string]: unknown;
};

export type DataExportResponse = {
  requestId?: string;
  downloadUrl?: string;
  status: string;
  [key: string]: unknown;
};

export type KycDocument = {
  id: string;
  documentType: string;
  status?: string;
  [key: string]: unknown;
};

export type KycSubmission = {
  id: string;
  status: string;
  provider?: string;
  providerRefId?: string;
  reviewNote?: string;
  documents?: KycDocument[];
  [key: string]: unknown;
};

export type KycVerificationEvent = {
  id: string;
  type: string;
  status?: string;
  createdAt?: string;
  payload?: JsonMap;
  [key: string]: unknown;
};

export const legalApi = {
  // ── Legal & GDPR ──
  getLegalDocuments: () => request<LegalDocument[]>("/legal/documents"),

  getLegalDocument: (slug: string) =>
    request<LegalDocumentContent>(`/legal/documents/${slug}/content`),

  getMyConsents: () => request<ConsentRecord[]>("/legal/consents"),

  getPendingConsents: () => request<ConsentRecord[]>("/legal/consents/pending"),

  getConsentHistory: () => request<ConsentRecord[]>("/legal/consents/history"),

  grantConsent: (documentId: string, consentType: string) =>
    request<ConsentRecord>("/legal/consents", {
      method: "POST",
      body: JSON.stringify({ documentId, consentType }),
    }),

  withdrawConsent: (consentType: string) =>
    request<ConsentRecord>("/legal/consents/withdraw", {
      method: "POST",
      body: JSON.stringify({ consentType }),
    }),

  getMyDataRequests: () => request<DataRequestRecord[]>("/legal/data-requests"),

  createDataRequest: (requestType: string, reason?: string) =>
    request<DataRequestRecord>("/legal/data-requests", {
      method: "POST",
      body: JSON.stringify({ requestType, reason }),
    }),

  exportMyData: () => request<DataExportResponse>("/legal/data-export"),

  // ── KYC (Production) ──
  getKycStatus: () =>
    request<{
      status: string;
      provider?: string;
      enabled?: boolean;
      level?: string;
      documents?: KycDocument[];
      rejectionReason?: string;
      submission?: KycSubmission;
      requireKycForPayout?: boolean;
    }>("/kyc/status"),

  startKyc: (data: {
    firstName: string;
    lastName: string;
    dateOfBirth?: string;
    nationality?: string;
    documentType?: string;
  }) =>
    request<{
      id?: string;
      submissionId?: string;
      status?: string;
      provider?: string;
      providerRefId?: string;
      sdkToken?: string;
      sdkUrl?: string;
    }>("/kyc/start", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  uploadKycDocument: (data: {
    submissionId: string;
    documentType: string;
    documentFrontUrl: string;
    documentBackUrl?: string;
    selfieUrl?: string;
  }) =>
    request<KycSubmission>("/kyc/documents", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getKycSubmissions: () => request<KycSubmission[]>("/kyc/submissions"),

  getKycVerificationEvents: (submissionId: string) =>
    request<KycVerificationEvent[]>(`/kyc/events/${submissionId}`),
};
