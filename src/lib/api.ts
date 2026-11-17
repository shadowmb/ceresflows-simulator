export class ApiClient {
    private static async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
        // Ensure we don't double-prefix if logic changes, but for now simple fix:
        // The calling code (App.tsx) passes '/api/controller'.
        // Vite proxy is set to capture '/api'.
        // So we just need to pass endpoint as is.
        const res = await fetch(endpoint, options);
        const data = await res.json();

        // Handle standard backend error format
        if (data && data.success === false) {
            throw new Error(data.error || 'Unknown error');
        }

        return data;
    }

    static async get<T>(endpoint: string): Promise<T> {
        return this.request<T>(endpoint);
    }

    static async post<T>(endpoint: string, body: any): Promise<T> {
        return this.request<T>(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
    }

    static async put<T>(endpoint: string, body: any): Promise<T> {
        return this.request<T>(endpoint, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
    }

    static async delete<T>(endpoint: string): Promise<T> {
        return this.request<T>(endpoint, { method: 'DELETE' });
    }
}
