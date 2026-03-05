import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

// Create axios instance
const api = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json'
    }
});

// Add token to requests
api.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

// Authentication API
export const authAPI = {
    signup: (data) => api.post('/auth/signup', data),
    login: (data) => api.post('/auth/login', data),
    getMe: () => api.get('/auth/me')
};

// Companies API
export const companiesAPI = {
    getAll: () => api.get('/companies'),
    getById: (id) => api.get(`/companies/${id}`),
    create: (data) => api.post('/companies', data),
    update: (id, data) => api.put(`/companies/${id}`, data),
    delete: (id) => api.delete(`/companies/${id}`),
    cleanup: (name) => api.delete(`/companies/cleanup/${encodeURIComponent(name)}`)
};

// Reports API
export const reportsAPI = {
    upload: (companyId, file) => {
        const formData = new FormData();
        formData.append('report', file);
        formData.append('companyId', companyId);

        return api.post('/reports/upload', formData, {
            headers: {
                'Content-Type': 'multipart/form-data'
            }
        });
    },
    getByCompany: (companyId) => api.get(`/reports/company/${companyId}`),
    getById: (reportId) => api.get(`/reports/${reportId}`),
    getStatus: (reportId) => api.get(`/reports/status/${reportId}`),
    delete: (reportId) => api.delete(`/reports/${reportId}`)
};

// News Impact API
export const newsAPI = {
    getByCompany: (companyId) => api.get(`/news/${companyId}`),
    refresh: (companyId) => api.post(`/news/refresh/${companyId}`),
    refreshAll: () => api.post('/news/refresh-all')
};

export default api;

