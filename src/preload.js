'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chronos', {
  stats: (from, to) => ipcRenderer.invoke('stats', from, to),
  live: () => ipcRenderer.invoke('live'),
  days: () => ipcRenderer.invoke('days'),
  icons: (list) => ipcRenderer.invoke('icons', list),
  siteIcons: (list) => ipcRenderer.invoke('site-icons', list),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  exportCsv: (from, to) => ipcRenderer.invoke('export', from, to),
  openData: () => ipcRenderer.invoke('open-data'),
  clearData: () => ipcRenderer.invoke('clear'),
  win: (action) => ipcRenderer.invoke('win', action),
  quit: () => ipcRenderer.invoke('quit'),
  updateState: () => ipcRenderer.invoke('update:state'),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  onLive: (cb) => {
    ipcRenderer.on('live', (e, data) => cb(data));
  },
  onUpdate: (cb) => {
    ipcRenderer.on('update', (e, data) => cb(data));
  }
});
