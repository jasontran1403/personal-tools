import api from './api'

export const listTodo = (from, to) =>
  api.get('/api/tools/vmb/todo', { params: { from, to } })

export const statsToday = () =>
  api.get('/api/tools/vmb/todo/stats/today')

export const createTodo = (body) =>
  api.post('/api/tools/vmb/todo', body)

export const updateTodo = (id, body) =>
  api.put(`/api/tools/vmb/todo/${id}`, body)

export const deleteTodo = (id) =>
  api.delete(`/api/tools/vmb/todo/${id}`)

export const completeTodo = (id, file, note) => {
  const fd = new FormData()
  fd.append('file', file)
  if (note) fd.append('note', note)
  return api.post(`/api/tools/vmb/todo/${id}/complete`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

export const extendTodo = (id, deadline, note) =>
  api.post(`/api/tools/vmb/todo/${id}/extend`, { deadline, note })

export const cancelTodo = (id, note) =>
  api.post(`/api/tools/vmb/todo/${id}/cancel`, { note })