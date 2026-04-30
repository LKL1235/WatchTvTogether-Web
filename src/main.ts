import { defineComponent, h } from 'vue'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHistory, RouterView } from 'vue-router'
import App from './App.vue'
import './assets/styles.css'

const Root = defineComponent({
  name: 'AppRoot',
  setup() {
    return () => h(RouterView)
  },
})

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'lobby', component: App },
    { path: '/room/:roomId', name: 'room', component: App, props: true },
  ],
})

createApp(Root).use(createPinia()).use(router).mount('#app')
