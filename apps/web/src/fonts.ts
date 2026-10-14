// wasm 빌드가 안에 품지 않는 번들 글꼴(엔진 `filmcraft_text::fonts::HOST_SUPPLIED_FONTS` 와 같은 목록). vite 가 해시 이름의
// 정적 자산으로 내보내고, Worker 가 시작할 때 wasm 과 나란히 받아 `addFontData` 로 등록한다. 목록이 어긋나면 Worker 가
// console.warn 으로 알린다. 파일은 저장소의 이식 엔진 assets/fonts 를 그대로 가리켜 복사본을 두지 않는다.
import interMedium from '../../../packages/engine/vendor/filmcraft/assets/fonts/Inter-Medium.ttf?url';
import interSemiBold from '../../../packages/engine/vendor/filmcraft/assets/fonts/Inter-SemiBold.ttf?url';
import interBold from '../../../packages/engine/vendor/filmcraft/assets/fonts/Inter-Bold.ttf?url';
import interItalic from '../../../packages/engine/vendor/filmcraft/assets/fonts/Inter-Italic.ttf?url';
import jetbrainsMono from '../../../packages/engine/vendor/filmcraft/assets/fonts/JetBrainsMono-Regular.ttf?url';
import notoSerif from '../../../packages/engine/vendor/filmcraft/assets/fonts/NotoSerif-Regular.ttf?url';
import pretendardRegular from '../../../packages/engine/vendor/filmcraft/assets/fonts/Pretendard-Regular.otf?url';
import pretendardBold from '../../../packages/engine/vendor/filmcraft/assets/fonts/Pretendard-Bold.otf?url';

export const hostFontUrls: string[] = [interMedium, interSemiBold, interBold, interItalic, jetbrainsMono, notoSerif, pretendardRegular, pretendardBold];
