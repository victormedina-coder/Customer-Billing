/**
 * Puerto de notificación de resultados de una corrida global. Vive en la capa
 * application (no domain) porque su contrato es el DTO GlobalRunReport, que es
 * un artefacto de aplicación. El adapter (infrastructure) lo implementa; el
 * route (interface) lo invoca. El caso de uso NO lo conoce — la corrida fiscal
 * es independiente de si el aviso se envía o no.
 */

import { GlobalRunReport } from "../EmitGlobalInvoiceUseCase";

export interface RunReportNotifier {
    notify(report: GlobalRunReport): Promise<void>;
}