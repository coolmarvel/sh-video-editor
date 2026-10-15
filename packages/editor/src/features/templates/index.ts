/** 템플릿(features/templates). 모듈을 읽는 것만으로 미디어 패널 탭 "템플릿" 을 등록한다. App.tsx 가 한 번 import 한다. */
import { registerMediaPanelTab } from '../media/panel-tabs';
import { TemplateGallery } from './TemplateGallery';

registerMediaPanelTab({ id: 'templates', label: '템플릿', order: 40, component: TemplateGallery });
