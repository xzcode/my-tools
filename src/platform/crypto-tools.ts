import { invoke } from '@tauri-apps/api/core';
import type { ToolRequest,ToolResult } from '../core/types';
import { isDesktop } from './desktop';
export interface KeyFile {name:string;data:string;encoding:'utf8'|'base64'}
export interface KeySet {name:string;files:string[]}
function requireDesktop(){if(!isDesktop())throw new Error('该密码学功能使用桌面原生 OpenSSL，请在安装版中操作。');}
export async function executeCrypto(request:ToolRequest):Promise<ToolResult>{requireDesktop();return invoke('crypto_execute',{request});}
export async function getKeyDirectory():Promise<string>{requireDesktop();return invoke('crypto_get_directory');}
export async function chooseKeyDirectory():Promise<string|null>{requireDesktop();return invoke('crypto_choose_directory');}
export async function saveKeys(name:string,files:KeyFile[]):Promise<string>{requireDesktop();return invoke('crypto_save_keys',{name,files});}
export async function openKeyDirectory(name?:string){requireDesktop();return invoke<void>('crypto_open_directory',{name:name??null});}
export async function listKeys():Promise<KeySet[]>{requireDesktop();return invoke('crypto_list_keys');}
export async function readKey(name:string,file:string):Promise<string>{requireDesktop();return invoke('crypto_read_key',{name,file});}
