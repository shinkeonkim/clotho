<!-- Vue 3 integration. -->
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { parseDocument, type AnimationDocument } from '@kokoa/clotho';
import { AnimationPlayer } from '@kokoa/clotho/vue';
import '@kokoa/clotho/styles.css';

const props = defineProps<{ id: string }>();
const doc = ref<AnimationDocument | null>(null);
const error = ref<string | null>(null);

onMounted(async () => {
  const response = await fetch(`/animations/${props.id}.json`);
  const result = parseDocument(await response.json());
  if (result.ok) doc.value = result.document;
  else error.value = result.issues.join('\n');
});
</script>

<template>
  <pre v-if="error" class="cloth-error">{{ error }}</pre>
  <div v-else-if="!doc" class="cloth-placeholder" />
  <AnimationPlayer v-else :doc="doc" />
</template>
