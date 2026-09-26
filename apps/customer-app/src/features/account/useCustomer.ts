import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiCustomer, CustomerRegisterCommand, CustomerUpdateCommand } from "@zhaoyun/contracts";
import { ApiError } from "@zhaoyun/api-client";
import { customerToken, restaurantApi, setCustomerToken } from "../../app/api";

export interface CustomerAccount {
  signedIn: boolean;
  customer: ApiCustomer | null;
  favorites: string[];
  signIn: (email: string, password: string) => Promise<void>;
  register: (command: CustomerRegisterCommand) => Promise<void>;
  signOut: () => Promise<void>;
  toggleFavorite: (productId: string) => Promise<void>;
  update: (command: CustomerUpdateCommand) => Promise<void>;
  remove: (password: string) => Promise<void>;
  /** After an order or a payment: the points may have changed. */
  refresh: () => void;
}

const KEY = ["customer"] as const;

/**
 * The signed-in guest (shared/customer.mjs): their account, favourites and
 * points. The session token lives on the phone (app/api.ts) and goes with
 * every request; a token the server no longer knows — expired, signed out
 * elsewhere, the password reset at the counter — signs the phone out.
 */
export function useCustomer(enabled: boolean): CustomerAccount {
  const queryClient = useQueryClient();
  const [token, setToken] = useState(customerToken);
  const remember = useCallback((next: string | null) => {
    setCustomerToken(next);
    setToken(next ?? "");
    if (!next) queryClient.removeQueries({ queryKey: KEY });
  }, [queryClient]);

  const profile = useQuery({
    queryKey: [...KEY, token],
    enabled: enabled && Boolean(token),
    retry: false,
    queryFn: async () => {
      try {
        return await restaurantApi.customer();
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) remember(null);
        throw error;
      }
    }
  });

  const set = (data: { customer: ApiCustomer; favorites: string[] }) => queryClient.setQueryData([...KEY, customerToken()], data);

  return {
    signedIn: Boolean(token && profile.data),
    customer: profile.data?.customer ?? null,
    favorites: profile.data?.favorites ?? [],
    async signIn(email, password) {
      const session = await restaurantApi.signInCustomer(email, password);
      remember(session.token);
    },
    async register(command) {
      const session = await restaurantApi.registerCustomer(command);
      remember(session.token);
    },
    async signOut() {
      await restaurantApi.signOutCustomer().catch(() => undefined);
      remember(null);
    },
    async toggleFavorite(productId) {
      const on = !(profile.data?.favorites ?? []).includes(productId);
      const { favorites } = await restaurantApi.setFavorite(productId, on);
      if (profile.data) set({ ...profile.data, favorites });
    },
    async update(command) {
      const updated = await restaurantApi.updateCustomer(command);
      // A new password ended every session, this phone's with a fresh one.
      if (updated.token) remember(updated.token);
      if (profile.data) set({ ...profile.data, customer: updated.customer });
    },
    async remove(password) {
      await restaurantApi.deleteCustomer(password);
      remember(null);
    },
    refresh() {
      void queryClient.invalidateQueries({ queryKey: KEY });
    }
  };
}
