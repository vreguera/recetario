# Recetario para 2

Web de recetas para dos: cenas rápidas, platos de diario, de finde y salsas. Está publicada con GitHub Pages en https://vreguera.github.io/recetario

Funciona en dos modos:

- **Modo local** (si `config.js` está vacío): se ven las recetas de `recetas.js` y las favoritas se guardan en cada navegador.
- **Modo cuentas** (con Supabase): cada uno entra con su email y tiene sus favoritas, ambos podéis añadir y editar recetas con foto, y cada receta tiene comentarios.

## Archivos

| Archivo | Qué es |
| --- | --- |
| `index.html` | Estructura de la página |
| `styles.css` | Diseño (claro y oscuro, versión de impresión para el PDF) |
| `recetas.js` | Recetas incluidas: copia sin conexión y semilla de la base de datos |
| `app.js` | Lógica: búsqueda, filtros, login, favoritas, editor, fotos, comentarios |
| `config.js` | URL y clave pública de Supabase |
| `supabase/setup.sql` | Tablas, reglas de seguridad (RLS), almacén de fotos y las 48 recetas iniciales |

## Activar las cuentas (unos 15 minutos)

1. **Crea el proyecto.** En https://supabase.com, regístrate y pulsa *New project*. Nombre: `recetario`. Región: *West EU (Ireland)* o *Central EU (Frankfurt)*. Guarda la contraseña de la base de datos aunque no la vayas a usar.
2. **Crea las tablas.** En *SQL Editor → New query*, pega el contenido entero de `supabase/setup.sql` y pulsa *Run*. Debe terminar sin errores; se puede volver a ejecutar sin problema.
3. **Cierra el registro.** En *Authentication → Sign In / Providers*, desactiva *Allow new users to sign up*. Deja activado *Email*. Así nadie más puede crearse una cuenta.
4. **Crea las dos cuentas.** En *Authentication → Users → Add user → Create new user*, pon email y contraseña de cada uno y marca *Auto Confirm User*.
5. **Dirección de la web.** En *Authentication → URL Configuration*, pon como *Site URL* `https://vreguera.github.io/recetario/`.
6. **Copia las claves.** En *Project Settings → API* (o *Data API*), copia la *Project URL* y la clave *anon / public*. Pégalas en `config.js` o pásaselas a Claude para que las suba.

La clave *anon* está pensada para ir en la web. La seguridad la ponen las reglas del script:

- Las recetas las puede leer cualquiera, pero solo vosotros dos podéis crearlas, editarlas o borrarlas.
- Cada uno solo ve sus favoritas.
- Los comentarios solo los ven los usuarios con sesión, y cada uno borra solo los suyos.

Nunca pongas en la web la clave *service_role*.

## Plan gratuito de Supabase

Si el proyecto pasa 7 días sin uso, Supabase lo pausa. Se reactiva desde su panel con *Restore project*. Mientras está pausado, la web sigue mostrando las recetas de `recetas.js`.
