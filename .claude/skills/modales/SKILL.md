---
name: modales
description: >
  Estilo obligatorio de modales y ventanas (Modal, Drawer) en la interfaz de HORNERA, para que
  todas se vean iguales: ficha de contexto arriba, secciones con título, pares pesos/dólares lado
  a lado, campos de plata con separador de miles, error al pie. Usar SIEMPRE que se agregue o
  modifique un Modal o Drawer en src/, o cuando el usuario pida una ventana, diálogo, formulario
  emergente o panel lateral.
---

La interfaz usa Ant Design con el tema "Ladrillo" (`src/main.tsx`) y CSS global en `index.html`.
Ese CSS ya separa con una línea el título y los botones de **todo** `.ant-modal`: no repetirlo ni
pisarlo con estilos inline. Lo que sigue es lo que cada modal tiene que hacer a mano.

Exponentes a copiar: `FormPago` en `src/Transferencias.tsx` (ficha + plata) y `AjustesReserva`
en `src/AjustesReserva.tsx` (secciones + pares pesos/dólares).

## Estructura de un Modal

```tsx
<Modal open={!!x} title={x && `Verbo/qué de ${x.codigo}`} okText="Guardar" cancelText="Cancelar"
  onOk={guardar} onCancel={() => alCerrar(false)} width={560} destroyOnHidden>
  {x && (
    <dl className="ficha">                       {/* contexto: a quién / qué / cuánto */}
      <dt>Depto</dt><dd><b>{x.codigo}</b> · {x.nombre}</dd>
      <dt>Estado</dt><dd><Tag color="blue">abierto</Tag></dd>
    </dl>
  )}
  <Form form={form} layout="vertical">
    <Typography.Text strong>Título de la sección</Typography.Text>
    <Typography.Paragraph type="secondary" style={{ margin: '0 0 8px' }}>Una línea que explica.</Typography.Paragraph>
    <Row gutter={12}>
      <Col span={12}><Form.Item label="Pesos" name="a"><InputNumber {...entradaPlata} prefix="$" style={{ width: '100%' }} /></Form.Item></Col>
      <Col span={12}><Form.Item label="Dólares" name="b"><InputNumber {...entradaPlata} prefix="US$" style={{ width: '100%' }} /></Form.Item></Col>
    </Row>
  </Form>
  {error && <Alert type="error" showIcon title={error} />}
</Modal>
```

## Reglas

- **Título**: qué se hace y sobre qué (`Pago de la liquidación de OVL`, `Variables de OVL · Hornera Lagos`).
  Sin "Modal", sin signos.
- **Botones**: `okText` con el verbo de la acción ("Guardar", "Marcar pagado"), `cancelText="Cancelar"`.
  Solo lectura (p. ej. mes cerrado) → `okButtonProps={{ disabled: true }}` y `<Form disabled>`.
- **Ancho**: por defecto el de Ant (520); con dos columnas o ficha, `width={560}`. Más ancho solo si
  hay una tabla adentro.
- **Ficha** (`<dl className="ficha">`): arriba del formulario cuando el modal actúa sobre algo
  (depto, propietario, mes, reserva). `dt` = rótulo corto, `dd` = valor; lo importante en `<b>` o
  `Typography.Text strong`; estados con `Tag`. No usar `Alert` para el contexto.
- **Secciones**: `Typography.Text strong` + `Typography.Paragraph type="secondary"` con
  `margin: '0 0 8px'`. No usar `Divider`, `Card` ni `<h3>` adentro de un modal.
- **Columnas**: `Row gutter={12}` + `Col span={12}`, campos con `style={{ width: '100%' }}`.
  Pesos a la izquierda, dólares a la derecha. `Space wrap` solo para controles chicos de ancho
  propio (fecha + importe, moneda + importe).
- **Plata**: siempre `InputNumber {...entradaPlata}` (de `src/api.ts`) con `prefix="$"`/`"US$"` o
  `prefix={simbolo(moneda)}`. Nunca `decimalSeparator`. Se edita en pesos y se manda en centavos
  (`Math.round(v * 100)`).
- **Porcentajes**: `InputNumber suffix="%"`, se muestran ×100 y se mandan /100.
- **Ayudas**: la explicación de un campo va en `Form.Item extra`; la de un grupo, en el párrafo de la
  sección. Nada de texto suelto al pie.
- **Error**: `{error && <Alert type="error" showIcon title={error} />}` después del `</Form>`, último
  elemento del modal. Validación de campos con `rules` (mensaje en español).
- **Colores**: los del tema (`theme.useToken()`, `Typography type="secondary"`/`"danger"`); nunca un hex
  inline (lo rechaza `src/estilos.test.ts`).
- **Ciclo de vida**: `destroyOnHidden`; cargar valores en un `useEffect` que corre al abrir; el
  componente avisa con `alCerrar(guardado: boolean)` y el padre recarga si `guardado`.

## Drawer

Para ver (historiales, detalle largo), no para cargar datos: `size={900}`, `destroyOnHidden`,
`title` = `Historial de OVL · Hornera Lagos`. Formularios siempre en Modal.

## Al terminar

Abrir el modal en la app (`npx electron . --user-data-dir=<carpeta temporal>` con datos
ficticios) y compararlo con `FormPago`: ficha, líneas, alineación de columnas, prefijos.
