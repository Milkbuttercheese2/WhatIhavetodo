/* =========================================================================
   저장 계층 — Rust(SQLite) 백엔드에 Tauri invoke()로 위임.
   실제 값은 모두 SQLite가 단일 진실 공급원이며, 브라우저 저장소(localStorage/
   IndexedDB)는 더 이상 쓰지 않는다.
   ========================================================================= */
import {S} from './state.js';
import {showSaveError, clearSaveError} from './dom-utils.js';

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
    if(this._saving) return this._saving;     // 진행 중 배치의 프로미스를 돌려줘 await가 실제로 완료를 기다리게
    this._saving=(async()=>{
      try{
        while(this._pending){
          const data=this._pending; this._pending=null;
          await invoke('save_all', {items:data});
        }
        clearSaveError();                       // 아이템 저장 성공 = 쓰기가 다시 됨 → 경고 해제(성공은 조용히)
      }catch(e){ console.warn('저장 실패',e); showSaveError(); }  // 실패는 눈에 보이게
      finally{ this._saving=null; }
    })();
    return this._saving;                       // await STORE.saveAll(...) 가 실제 저장 완료까지 대기
  },

  /* 사이드카 저장(필드·프리셋·식별정보 명칭·설정)도 실패하면 경고를 켠다. 단
     성공해도 경고를 끄지는 않는다 — 설정 저장 성공이 아이템 저장 실패를 가리면
     안 되므로, 해제는 아이템 저장(save_all) 성공만 담당한다. */
  saveFields(f){ if(!S.loaded)return; invoke('save_fields', {fields:f}).catch(e=>{console.warn('필드 저장 실패',e);showSaveError();}); },
  savePresets(p){ if(!S.loaded)return; invoke('save_presets', {presets:p}).catch(e=>{console.warn('프리셋 저장 실패',e);showSaveError();}); },
  saveIdKinds(k){ if(!S.loaded)return; invoke('save_id_kinds', {idKinds:k}).catch(e=>{console.warn('식별번호 명칭 저장 실패',e);showSaveError();}); },
  saveSettings(s){ if(!S.loaded)return; invoke('save_settings', {settings:s}).catch(e=>{console.warn('설정 저장 실패',e);showSaveError();}); },

  /* 화면 크기(v2.5.15) — 데이터 저장이 아니라 웹뷰 배율 적용이므로 F1 로드
     게이트를 걸지 않는다(로드 완료 전에도 저장된 크기를 그대로 보여줘야 한다). */
  setUiScale(n){ invoke('set_ui_scale', {scale:n}).catch(e=>console.warn('화면 크기 적용 실패',e)); }
};
