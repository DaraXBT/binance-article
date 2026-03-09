// Theme presets with 15 default themes
export const THEME_PRESETS = {
  default: {
    name: "Default",
    colors: {
      primary: "#3B82F6",
      secondary: "#1E293B",
      accent: "#EC4899",
      background: "#FFFFFF",
      text: "#1F2937",
    },
  },
  minimalist: {
    name: "Minimalist",
    colors: {
      primary: "#000000",
      secondary: "#FFFFFF",
      accent: "#808080",
      background: "#FFFFFF",
      text: "#000000",
    },
  },
  ocean: {
    name: "Ocean",
    colors: {
      primary: "#0369A1",
      secondary: "#0C4A6E",
      accent: "#06B6D4",
      background: "#F0F9FF",
      text: "#0C2340",
    },
  },
  sunset: {
    name: "Sunset",
    colors: {
      primary: "#DC2626",
      secondary: "#92400E",
      accent: "#FCA5A5",
      background: "#FEF3C7",
      text: "#78350F",
    },
  },
  forest: {
    name: "Forest",
    colors: {
      primary: "#15803D",
      secondary: "#166534",
      accent: "#86EFAC",
      background: "#F0FDF4",
      text: "#14532D",
    },
  },
  lavender: {
    name: "Lavender",
    colors: {
      primary: "#6D28D9",
      secondary: "#4C1D95",
      accent: "#A78BFA",
      background: "#FAF5FF",
      text: "#3730A3",
    },
  },
  coral: {
    name: "Coral",
    colors: {
      primary: "#F97316",
      secondary: "#7C2D12",
      accent: "#FDBA74",
      background: "#FFF7ED",
      text: "#5A2E0F",
    },
  },
  slate: {
    name: "Slate",
    colors: {
      primary: "#475569",
      secondary: "#1E293B",
      accent: "#CBD5E1",
      background: "#F8FAFC",
      text: "#0F172A",
    },
  },
  emerald: {
    name: "Emerald",
    colors: {
      primary: "#059669",
      secondary: "#065F46",
      accent: "#6EE7B7",
      background: "#F0FDF4",
      text: "#064E3B",
    },
  },
  rose: {
    name: "Rose",
    colors: {
      primary: "#E11D48",
      secondary: "#831843",
      accent: "#FB7185",
      background: "#FFF1F2",
      text: "#500724",
    },
  },
  indigo: {
    name: "Indigo",
    colors: {
      primary: "#4F46E5",
      secondary: "#312E81",
      accent: "#A5B4FC",
      background: "#F0F4FF",
      text: "#1E1B4B",
    },
  },
  teal: {
    name: "Teal",
    colors: {
      primary: "#0D9488",
      secondary: "#134E4A",
      accent: "#5EEAD4",
      background: "#F0FDFA",
      text: "#0D3331",
    },
  },
  amber: {
    name: "Amber",
    colors: {
      primary: "#D97706",
      secondary: "#78350F",
      accent: "#FBBF24",
      background: "#FFFBEB",
      text: "#451A03",
    },
  },
  cyan: {
    name: "Cyan",
    colors: {
      primary: "#0891B2",
      secondary: "#082F49",
      accent: "#22D3EE",
      background: "#F0F9FA",
      text: "#082F49",
    },
  },
  fuchsia: {
    name: "Fuchsia",
    colors: {
      primary: "#D946EF",
      secondary: "#701A86",
      accent: "#F0ABFC",
      background: "#FDF5FF",
      text: "#3D0959",
    },
  },
};

// Export config for job queue
export const JOB_QUEUE_CONFIG = {
  maxConcurrent: parseInt(process.env.MAX_CONCURRENT_JOBS || "2", 10),
  timeoutMs: parseInt(process.env.JOB_TIMEOUT_MS || "300000", 10),
};

// Render settings
export const RENDER_CONFIG = {
  timeoutMs: parseInt(process.env.RENDER_TIMEOUT_MS || "60000", 10),
  outputDir: process.env.RENDER_OUTPUT_DIR || "public/renders",
};

// Validation rules
export const VALIDATION = {
  TITLE_MAX_LENGTH: 200,
  DESCRIPTION_MAX_LENGTH: 1000,
  CONTENT_MAX_LENGTH: 50000,
  SLIDE_TITLE_MAX_LENGTH: 150,
  SLIDE_BULLETS_MAX: 7,
  BULLET_MAX_LENGTH: 200,
  NOTES_MAX_LENGTH: 500,
};
