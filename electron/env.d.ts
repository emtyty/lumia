/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MAIN_VITE_R2_ACCOUNT_ID: string
  readonly MAIN_VITE_R2_ACCESS_KEY_ID: string
  readonly MAIN_VITE_R2_SECRET_ACCESS_KEY: string
  readonly MAIN_VITE_R2_BUCKET: string
  readonly MAIN_VITE_R2_PUBLIC_URL: string
  readonly MAIN_VITE_GDRIVE_CLIENT_ID: string
  readonly MAIN_VITE_GDRIVE_CLIENT_SECRET: string
  readonly MAIN_VITE_GDRIVE_API_KEY: string
  readonly MAIN_VITE_GDRIVE_PROJECT_NUMBER: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
