import axios from 'axios'

const BASE = import.meta.env.VITE_API_URL || '/api'

const client = axios.create({ baseURL: BASE })

// Attach JWT on every request if present
client.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Redirect to /login on 401
client.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default client

// ── Auth ──────────────────────────────────────────────────────────────────────
export const register = (data) => client.post('/auth/register', data)
export const login = (data) => client.post('/auth/login', data)

// ── Nodes (auth required) ─────────────────────────────────────────────────────
export const listNodes = () => client.get('/nodes')
export const createNode = (data) => client.post('/nodes', data)
export const updateNode = (id, data) => client.put(`/nodes/${id}`, data)
export const deleteNode = (id) => client.delete(`/nodes/${id}`)
export const blockNode = (id) => client.post(`/nodes/${id}/block`)
export const startNode = (id) => client.post(`/nodes/${id}/start`)

// ── History ───────────────────────────────────────────────────────────────────
export const getHistory = () => client.get('/history')

// ── Networks (public) ─────────────────────────────────────────────────────────
export const listNetworks = () => client.get('/network/list')
