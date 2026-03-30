export type KpisResponse = {
  meta: { generatedAt: string; timezone: string };
  data: {
    leads: { total: number; last7d: number; last30d: number; byCanal: { canal: string; count: number }[] };
    membresias: { total: number; registrado: number; confirmado: number; pagadoSi: number; pagadoNo: number; porTipo: { membresia: string; count: number }[] };
    conversion: { leadsConMembresia: number; tasa: number };
  };
};

export type Paged<T> = {
  meta: {
    generatedAt: string;
    timezone: string;
    total: number;
    page: number;
    pageSize: number;
    filters: Record<string, any>;
  };
  data: T[];
};

export type LeadRow = {
  row_number: number;
  FechaHoraPrimerContacto: string;
  Canal: string;
  Nombre: string;
  Celular: string;
  ConversationId: number | string;
  UltimoMensaje: string;
  LeadKey: string;
  hasCelular: boolean;
};

export type MembresiaRow = {
  id: string;
  row_number: number;
  FechaHora: string;
  Canal: string;
  Nombre: string;
  Celular: string;
  Inicio: string;
  ConversationId: number | string;
  Notas: string;
  Membresia: string;
  LeadKey: string;
  Estado: string;
  Pagado: string;
  MetodoPago: string;
  FechaPago: string;
};
