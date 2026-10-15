/**
 * features/audio: 오디오 재생(모니터 동기), 인스펙터 "오디오" 탭, 타임라인 파형, 음악 라이브러리 탭.
 * App 이 이 모듈을 import 하면 탭 등록이 끝난다(레지스트리 방식: features/inspector, features/media/panel-tabs).
 */
import { registerInspectorTab } from '../inspector/registry';
import { registerMediaPanelTab } from '../media/panel-tabs';
import { AudioInspector, hasAudioClip } from './AudioInspector';
import { MusicLibrary } from './MusicLibrary';

registerInspectorTab({ id: 'audio', label: '오디오', order: 40, when: hasAudioClip, component: AudioInspector });
registerMediaPanelTab({ id: 'music', label: '음악', order: 20, component: MusicLibrary });
