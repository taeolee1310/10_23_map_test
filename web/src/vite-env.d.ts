/// <reference types="vite/client" />

// 카카오 지도 SDK는 스크립트로 불러와서 전역 kakao가 생긴다
interface Window {
  kakao: any
}

interface ImportMetaEnv {
  readonly KAKAO_JS_KEY?: string
}
