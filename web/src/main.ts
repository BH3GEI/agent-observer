import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { installClickSparks, vTilt, vCountup } from './composables/useFx'
import { initAuth } from './stores/auth'
import './assets/styles/main.css'

void initAuth()
createApp(App).directive('tilt', vTilt).directive('countup', vCountup).use(router).mount('#app')

installClickSparks()
