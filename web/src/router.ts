import { createRouter, createWebHistory, type RouteLocationNormalized } from 'vue-router'
import HomePage from './pages/HomePage.vue'
import { initAuth, refreshMe, useAuth } from './stores/auth'
import { applyDocumentMeta } from './composables/useI18n'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', component: HomePage , meta: { page: 'home' }},
    { path: '/brief', component: () => import('./pages/VisionPage.vue') , meta: { page: 'brief' }},
    { path: '/vision', redirect: '/brief' },
    { path: '/rules', component: () => import('./pages/RulesPage.vue') , meta: { page: 'rules' }},
    { path: '/docs', component: () => import('./pages/DocsPage.vue') , meta: { page: 'docs' }},
    { path: '/faq', component: () => import('./pages/FaqPage.vue') , meta: { page: 'faq' }},
    { path: '/resources', component: () => import('./pages/ResourcesPage.vue') , meta: { page: 'resources' }},
    { path: '/leaderboard/:phase?', component: () => import('./pages/LeaderboardPage.vue') , meta: { page: 'leaderboard' }},
    { path: '/announcements', component: () => import('./pages/AnnouncementsPage.vue') , meta: { page: 'announcements' }},
    { path: '/register', component: () => import('./pages/RegisterPage.vue') , meta: { page: 'register' }},
    { path: '/login', redirect: to => ({ path: '/register', query: { ...to.query, mode: 'login' } }) },
    { path: '/forgot', redirect: to => ({ path: '/register', query: { ...to.query, mode: 'forgot' } }) },
    { path: '/reset', component: () => import('./pages/ResetPage.vue') , meta: { page: 'reset' }},
    { path: '/dashboard', component: () => import('./pages/DashboardPage.vue'), meta: { page: 'dashboard', auth: true } },
    { path: '/team', component: () => import('./pages/TeamPage.vue'), meta: { page: 'team', auth: true } },
    { path: '/submit', component: () => import('./pages/SubmitPage.vue'), meta: { page: 'submit', auth: true } },
    { path: '/submissions', component: () => import('./pages/SubmissionsPage.vue'), meta: { page: 'submissions', auth: true } },
    { path: '/submissions/:id', component: () => import('./pages/SubmissionDetailPage.vue'), meta: { page: 'submission', auth: true } },
    { path: '/profile', component: () => import('./pages/ProfilePage.vue'), meta: { page: 'profile', auth: true } },
    { path: '/admin', component: () => import('./pages/admin/AdminOverviewPage.vue'), meta: { page: 'admin', auth: true, admin: true } },
    { path: '/admin/phases', component: () => import('./pages/admin/AdminPhasesPage.vue'), meta: { page: 'admin', auth: true, admin: true } },
    { path: '/admin/scenarios', component: () => import('./pages/admin/AdminScenariosPage.vue'), meta: { page: 'admin', auth: true, admin: true } },
    { path: '/admin/submissions', component: () => import('./pages/admin/AdminSubmissionsPage.vue'), meta: { page: 'admin', auth: true, admin: true } },
    { path: '/admin/users', component: () => import('./pages/admin/AdminUsersPage.vue'), meta: { page: 'admin', auth: true, admin: true } },
    { path: '/admin/teams', component: () => import('./pages/admin/AdminTeamsPage.vue'), meta: { page: 'admin', auth: true, admin: true } },
    { path: '/admin/announcements', component: () => import('./pages/admin/AdminAnnouncementsPage.vue'), meta: { page: 'admin', auth: true, admin: true } },
    { path: '/admin/credits', component: () => import('./pages/admin/AdminCreditsPage.vue'), meta: { page: 'admin', auth: true, admin: true } },
    { path: '/admin/settings', component: () => import('./pages/admin/AdminSettingsPage.vue'), meta: { page: 'admin', auth: true, admin: true } },
    { path: '/:pathMatch(.*)*', component: () => import('./pages/NotFoundPage.vue') , meta: { page: 'not_found' }},
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

router.afterEach(to => { applyDocumentMeta(typeof to.meta.page === 'string' ? to.meta.page : 'home') })

export default router
