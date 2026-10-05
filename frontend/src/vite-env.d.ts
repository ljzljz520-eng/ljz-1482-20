/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API 绝对地址（Vercel 静态部署使用）；留空时走同源/代理 */
  readonly VITE_API_BASE?: string;
  /** Trae/本地 Vite 预览时 /api 的代理目标 */
  readonly VITE_API_PROXY_TARGET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
