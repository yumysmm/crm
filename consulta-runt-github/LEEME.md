# Desplegar consulta-runt desde GitHub (sin instalar nada)

1. Crea un repositorio **privado** en GitHub y sube el contenido de esta carpeta (respetando las rutas).
2. En Supabase: avatar > Account > Access Tokens > Generate new token. Copia el token.
3. En el repositorio: Settings > Secrets and variables > Actions > New repository secret. Crea dos:
   - `SUPABASE_ACCESS_TOKEN` = el token del paso 2
   - `PLACAPI_KEY` = tu clave de PlacApi
4. Pestaña Actions > "Desplegar consulta-runt" > Run workflow.
5. En el CRM: Herramientas > Vencimientos RUNT > Verificar conexión.

Si cambias `index.ts` y lo subes, se vuelve a desplegar solo.
