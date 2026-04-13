/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MAIN_VITE_R2_ACCOUNT_ID: string
  readonly MAIN_VITE_R2_ACCESS_KEY_ID: string
  readonly MAIN_VITE_R2_SECRET_ACCESS_KEY: string
  readonly MAIN_VITE_R2_BUCKET: string
  readonly MAIN_VITE_R2_PUBLIC_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
