export interface Product {
  id: string;
  name: string;
  price: string;
  available: number; // stock minus active reservations
  saleEndsAt?: string | null; // ISO time; null/absent means no deadline
}

export interface Reservation {
  reservationId: string;
  productId: string;
  quantity: number;
  expiresAt: string; // ISO, decided by the server
}

export interface Order {
  id: string;
  totalAmount: string;
  status: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public available?: number, // set on 409 insufficient stock
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}) {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.message ?? "Request failed", body.available);
  // The Date header is the server clock; used to correct client clock skew.
  const serverNow = res.headers.get("date");
  return { data: body.data as T, serverNow: serverNow ? Date.parse(serverNow) : Date.now() };
}

const json = (userId: string, extra: Record<string, string> = {}) => ({
  "Content-Type": "application/json",
  "x-user-id": userId,
  ...extra,
});

export const listProducts = () => request<Product[]>("/products");

export const createUser = (name: string, email: string) =>
  request<User>("/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email }),
  });

export const reserve = (userId: string, productId: string, quantity: number) =>
  request<Reservation>("/cart/reserve", {
    method: "POST",
    headers: json(userId),
    body: JSON.stringify({ productId, quantity }),
  });

export const checkout = (userId: string, reservationId: string, idempotencyKey: string) =>
  request<Order>("/order/checkout", {
    method: "POST",
    headers: json(userId, { "idempotency-key": idempotencyKey }),
    body: JSON.stringify({ reservationId }),
  });
