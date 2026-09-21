import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { installClickSparks, vTilt, vCountup } from './composables/useFx'
import { consoleGreeting, installMoonFavicon } from './lib/eggs'
import { initAuth } from './stores/auth'
import './assets/styles/main.css'

// A deploy can replace hashed chunks under a visitor mid-session; reload once instead of white-screening.
window.addEventListener('vite:preloadError', event => {
  event.preventDefault()
  const key = 'sac-chunk-reload'
  if (sessionStorage.getItem(key)) return
  sessionStorage.setItem(key, '1')
  location.reload()
})
window.addEventListener('load', () => sessionStorage.removeItem('sac-chunk-reload'))

void initAuth()
createApp(App).directive('tilt', vTilt).directive('countup', vCountup).use(router).mount('#app')

installClickSparks()
installMoonFavicon()
consoleGreeting()
