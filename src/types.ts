export interface SectionConfig {
  mode: "ai" | "manual";
  text: string;
}

export interface SermonStructure {
  introducao: SectionConfig;
  desenvolvimento: SectionConfig & { numPoints: number };
  conclusao: SectionConfig;
  apelo: SectionConfig;
}

export interface SermonResponse {
  success: boolean;
  introducao: string;
  desenvolvimento: string;
  conclusao: string;
  apelo: string;
  referencias: string;
  docxBase64: string;
}

export interface UserSession {
  email: string;
}
