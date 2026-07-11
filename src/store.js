/* =========================================================================
   저장 계층 — Rust(SQLite) 백엔드에 Tauri invoke()로 위임.
   실제 값은 모두 SQLite가 단일 진실 공급원이며, 브라우저 저장소(localStorage/
   IndexedDB)는 더 이상 쓰지 않는다.
   ========================================================================= */
import {S} from './state.js';

export const { invoke } = window.__TAURI__.core;

export const STORE = {
  _saving:null, _pending:null,

  /* fields/presets/idKinds/settings는 S.imported 로 비동기 전달되고,
     초기 로드(main.js)가 reconcileImported()를 호출해 그 값을 반영한다
     (기존 IndexedDB 버전도 동일한 패턴이었다 — 동기 기본값으로 시작,
     STORE.load() 완료 후 진짜 값으로 교체). */
  async load(){
    const state = await invoke('load_all');
    if(Array.isArray(state.fields)) S.imported.fields=state.fields;
    if(Array.isArray(state.presets)) S.imported.presets=state.presets;
    if(Array.isArray(state.idKinds)) S.imported.idKinds=state.idKinds;
    if(state.settings && typeof state.settings==='object') S.imported.settings=state.settings;
    if(Array.isArray(state.recurDefs)) S.imported.recurDefs=state.recurDefs;
    return Array.isArray(state.items)?state.items:[];
  },

  async saveAll(items){
    if(!S.loaded) return;                     // F1: 초기 로드 완료 전 저장 차단 (기존 데이터 소실 방지)
    this._pending=items;
    if(this._saving) return;
    this._saving=(async()=>{
      try{
        while(this._pending){
          const data=this._pending; this._pending=null;
          await invoke('save_all', {items:data});
        }
      }catch(e){ console.warn('저장 실패',e); }
      finally{ this._saving=null; }
    })();
  },

  saveFields(f){ if(!S.loaded)return; invoke('save_fields', {fields:f}).catch(e=>console.warn('필드 저장 실패',e)); },
  savePresets(p){ if(!S.loaded)return; invoke('save_presets', {presets:p}).catch(e=>console.warn('프리셋 저장 실패',e)); },
  saveIdKinds(k){ if(!S.loaded)return; invoke('save_id_kinds', {idKinds:k}).catch(e=>console.warn('식별번호 명칭 저장 실패',e)); },
  saveSettings(s){ if(!S.loaded)return; invoke('save_settings', {settings:s}).catch(e=>console.warn('설정 저장 실패',e)); }
};
