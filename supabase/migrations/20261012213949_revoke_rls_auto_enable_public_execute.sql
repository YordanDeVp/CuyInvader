-- Conserva el event trigger (propietario postgres), pero bloquea la llamada
-- directa por RPC desde los roles expuestos al navegador.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
