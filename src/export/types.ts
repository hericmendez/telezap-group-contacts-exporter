/**
 * Normalized contact representation for CSV export.
 * This is the boundary between whatsapp-web.js types and the exporter.
 */
export interface ExportedContact {
  whatsappId: string;
  name: string;
  pushname: string;
  number: string;
  isAdmin: boolean;
  isSuperAdmin: boolean;
}
