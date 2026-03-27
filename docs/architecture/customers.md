# Customers Domain

> Customer master data for both retail and wholesale channels.

## Entity Relationship Diagram

```mermaid
erDiagram
    Clientes {
        float RegCliente PK "Internal record ID"
        text Cliente "Customer name"
        float Codigo "Customer code"
        text CIF "Tax ID (NIF/CIF)"
        text Direccion "Billing address"
        text Poblacion "City"
        text Provincia "Province"
        text Postal "Postal code"
        text Telefono "Phone"
        text Telefono2 "Phone 2"
        text Movil "Mobile"
        text Fax "Fax"
        text DireccionE "Shipping address"
        text PoblacionE "Shipping city"
        text ProvinciaE "Shipping province"
        text PostalE "Shipping postal code"
        text FormaPago "Payment method"
        float PDescCom "Commercial discount %"
        float ImpTarjetaPuntos "Loyalty card points"
        boolean LlevaIva "Subject to VAT"
        boolean LlevaRE "Subject to surcharge"
        boolean BloqueoFinancials "Financial block"
        int RiesgoConcedid "Credit limit"
        text Tienda "Home store code"
        float NumComercial FK "-> GCComerciales.RegComercial"
        text Transportista "Default carrier"
        text Contacto1 "Contact person"
        text Marketing1 "Marketing segment 1"
        text Marketing2 "Marketing segment 2"
        date FechaCreacion "Creation date"
        date FechaModifica "Last modified"
    }

    TiposClientes {
        text TipoCliente "Client type name"
    }

    GrupoClientes {
        text GrupoCliente "Client group name"
    }

    OPClientes {
        text Descripcion "Optical client data"
    }

    GCComerciales {
        float RegComercial PK "Sales rep record ID"
        text Comercial "Sales rep name"
        text ZonaComercial "Commercial zone"
        float Comision1 "Commission rate 1"
    }

    Ventas {
        float RegVentas PK "Sale record ID"
        float NumCliente FK "-> Clientes"
        text Cliente "Customer name"
    }

    GCAlbaranes {
        float RegAlbaran PK "Delivery note ID"
        float NumCliente FK "-> Clientes"
    }

    GCFacturas {
        float RegFactura PK "Invoice ID"
        float NumCliente FK "-> Clientes"
    }

    CobrosFacturas {
        float RegCobroRefAde PK "Collection record ID"
        float NumCliente FK "-> Clientes"
    }

    Clientes }o--|| GCComerciales : "NumComercial -> RegComercial"
    Clientes ||--o{ Ventas : "RegCliente -> NumCliente"
    Clientes ||--o{ GCAlbaranes : "RegCliente -> NumCliente"
    Clientes ||--o{ GCFacturas : "RegCliente -> NumCliente"
    Clientes ||--o{ CobrosFacturas : "RegCliente -> NumCliente"
```

## Table Descriptions

| Table | Rows | Columns | Description |
|-------|------|---------|-------------|
| **Clientes** | 27,530 | 311 | Customer master. Stores name, billing/shipping addresses, contact info, payment terms, bank details (IBAN/BIC), credit risk, loyalty card, commercial zone, wholesale flags, and CRM/marketing fields. |
| **TiposClientes** | 15 | -- | Customer type classification (e.g., retail, wholesale, VIP). |
| **GCComerciales** | 5 | 50 | Sales representatives linked to customers. |

## Empty / Unused Tables in This Domain

| Table | Columns | Description |
|-------|---------|-------------|
| GrupoClientes | 0 | Customer groups for segmentation. Not in use. |
| OPClientes | 0 | Optical-specific customer data. Not in use. |
| CRMCampañas | 18 | CRM marketing campaigns. Not in use. |
| CRMAsociados | 0 | CRM associated contacts. Not in use. |
| CRMCargaOPPrue | 0 | CRM data loading. Not in use. |
| CRMCuestionarios | 0 | CRM questionnaires. Not in use. |
| CRMDetalleCue | 0 | CRM questionnaire details. Not in use. |
| CRMVisitados | 0 | CRM visit tracking. Not in use. |
| ValesClientes | 0 | Customer-specific vouchers. Not in use. |

## Notes

- **Clientes** has 311 columns including: multiple address sets (billing, shipping, invoicing), up to 12 payment installment fields, bank details (Banco, Agencia, CuentaCorriente, IBAN, BIC), risk management (RiesgoConcedid, BloqueoFinancials), loyalty (ImpTarjetaPuntos), and extensive CRM fields.
- The same `Clientes` table serves both retail POS customers (linked via `Ventas.NumCliente`) and wholesale clients (linked via `GCAlbaranes.NumCliente`, `GCFacturas.NumCliente`).
- **Wholesale flag**: Clientes likely contains a `Mayorista` flag or similar to distinguish B2B vs B2C customers.
- **GCComerciales** links customers to sales representatives via `Clientes.NumComercial -> GCComerciales.RegComercial`.
- The CRM module (CRMCampañas, CRMVisitados, etc.) exists in the schema but is completely empty.
