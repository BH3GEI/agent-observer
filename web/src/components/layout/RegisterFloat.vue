<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from '../../composables/useI18n'
import { useAuth } from '../../stores/auth'
import { useRegistrationOpen } from '../../composables/useRegistrationOpen'

const { t } = useI18n()
const route = useRoute()
const { isLoggedIn } = useAuth()
const { registrationOpen } = useRegistrationOpen()
const show = computed(() => !isLoggedIn.value && registrationOpen.value && route.path !== '/register')
</script>

<template>
  <router-link v-if="show" to="/register" class="register-float btn primary" data-testid="register-float">
    {{ t('nav.register_float') }} →
  </router-link>
</template>
