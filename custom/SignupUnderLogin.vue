<template>
  <p class="af-signup-link text-sm text-left mt-3 text-lightLoginViewSubTextColor dark:text-darkLoginViewSubTextColor">
    {{$t('Have no account?')}} 
    <Link :to="`/signup${route.query.next ? `?next=${encodeURIComponent(route.query.next)}` : ''}`">
      {{$t('sign up now')}}
    </Link>
  </p>
</template>

<script setup>
import Link from '@/afcl/Link.vue';
import { useRoute } from 'vue-router';

const route = useRoute();

</script>