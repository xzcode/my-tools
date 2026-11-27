<script setup lang="ts">
import { computed } from 'vue';
import { Braces, TextCursorInput, Type, Binary, Link, Clock3, Fingerprint, Hash, KeyRound, Database, ListFilter, Regex, GitCompare, ArrowLeftRight, Terminal, FileJson2, LockKeyhole, ShieldCheck, Phone, Film } from '@lucide/vue';

const props = defineProps<{ id: string; size?: number }>();
const icons = { json: Braces, 'string-join': TextCursorInput, text: Type, base64: Binary, url: Link, timestamp: Clock3, uuid: Fingerprint, hash: Hash, jwt: KeyRound, sql: Database, 'sql-in': ListFilter, regex: Regex, 'text-diff': GitCompare, 'json-diff': FileJson2, convert: ArrowLeftRight, curl: Terminal, aes: LockKeyhole, password: ShieldCheck, phone: Phone, svga: Film };
const icon = computed(() => icons[props.id as keyof typeof icons] || Braces);
</script>

<template><component :is="icon" :size="size || 18" :stroke-width="1.7" aria-hidden="true" /></template>
