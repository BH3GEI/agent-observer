import { createRouter, createWebHistory, type RouteLocationNormalized } from 'vue-router'
import HomePage from './pages/HomePage.vue'
import { initAuth, refreshMe, useAuth } from './stores/auth'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', component: HomePage },
    { path: '/brief', component: () => import('./pages/VisionPage.vue') },
    { path: '/vision', redirect: '/brief' },
    { path: '/rules', component: () => import('./pages/RulesPage.vue') },
    { path: '/docs', component: () => import('./pages/DocsPage.vue') },
    { path: '/faq', component: () => import('./pages/FaqPage.vue') },
    { path: '/resources', component: () => import('./pages/ResourcesPage.vue') },
    { path: '/leaderboard/:phase?', component: () => import('./pages/LeaderboardPage.vue') },
    { path: '/announcements', component: () => import('./pages/AnnouncementsPage.vue') },
    { path: '/register', component: () => import('./pages/RegisterPage.vue') },
    { path: '/login', redirect: to => ({ path: '/register', query: { ...to.query, mode: 'login' } }) },
    { path: '/forgot', redirect: to => ({ path: '/register', query: { ...to.query, mode: 'forgot' } }) },
    { path: '/reset', component: () => import('./pages/ResetPage.vue') },
    { path: '/dashboard', component: () => import('./pages/DashboardPage.vue'), meta: { auth: true } },
    { path: '/team', component: () => import('./pages/TeamPage.vue'), meta: { auth: true } },
    { path: '/submit', component: () => import('./pages/SubmitPage.vue'), meta: { auth: true } },
    { path: '/submissions', component: () => import('./pages/SubmissionsPage.vue'), meta: { auth: true } },
    { path: '/submissions/:id', component: () => import('./pages/SubmissionDetailPage.vue'), meta: { auth: true } },
    { path: '/profile', component: () => import('./pages/ProfilePage.vue'), meta: { auth: true } },
    { path: '/admin', component: () => import('./pages/admin/AdminOverviewPage.vue'), meta: { auth: true, admin: true } },
    { path: '/admin/phases', component: () => import('./pages/admin/AdminPhasesPage.vue'), meta: { auth: true, admin: true } },
    { path: '/admin/scenarios', component: () => import('./pages/admin/AdminScenariosPage.vue'), meta: { auth: true, admin: true } },
    { path: '/admin/submissions', component: () => import('./pages/admin/AdminSubmissionsPage.vue'), meta: { auth: true, admin: true } },
    { path: '/admin/users', component: () => import('./pages/admin/AdminUsersPage.vue'), meta: { auth: true, admin: true } },
    { path: '/admin/teams', component: () => import('./pages/admin/AdminTeamsPage.vue'), meta: { auth: true, admin: true } },
    { path: '/admin/announcements', component: () => import('./pages/admin/AdminAnnouncementsPage.vue'), meta: { auth: true, admin: true } },
    { path: '/admin/settings', component: () => import('./pages/admin/AdminSettingsPage.vue'), meta: { auth: true, admin: true } },
    { path: '/:pathMatch(.*)*', component: () => import('./pages/NotFoundPage.vue') },
  ],
  scrollBehavior(to, _from, savedPosition) {
    if (savedPosition) return savedPosition
    if (to.hash) {
      return new Promise(resolve => {
        window.setTimeout(() => resolve({ el: to.hash, top: 64, behavior: 'smooth' }), 50)
      })
    }
    return { top: 0 }
  },
})

router.beforeEach(async (to: RouteLocationNormalized) => {
  if (!to.meta.auth) return true
  await initAuth()
  const { state } = useAuth()
  if (!state.session) return { path: '/register', query: { mode: 'login', next: to.fullPath } }
  if (to.meta.admin) {
    if (!state.me) await refreshMe()
    if (!state.me?.is_admin) return { path: '/dashboard', query: { denied: '1' } }
  }
  return true
})

export default router
