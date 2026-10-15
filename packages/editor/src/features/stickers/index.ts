/** 스티커(features/stickers). 모듈을 읽는 것만으로 미디어 패널 탭 "스티커" 를 등록한다. App.tsx 가 한 번 import 한다. */
import { registerMediaPanelTab } from '../media/panel-tabs';
import { StickerGallery } from './StickerGallery';

registerMediaPanelTab({ id: 'stickers', label: '스티커', order: 30, component: StickerGallery });
