import { Tariff } from '../../entities/tariff.entity';

/** Custom tarif konfiguratsiyasi (tanlangan miqdorlar) */
export interface CustomLimits {
  branches: number;
  employees: number;
  devices: number;
}

/**
 * Oylik narxni (tiyin'da) hisoblaydigan sof funksiya.
 * - Custom tarif → `basePrice + branches*perBranch + employees*perEmployee + devices*perDevice`.
 *   `limits` berilmasa tarif MAKS chegaralari (`max*`) bo'yicha hisoblanadi.
 * - Oddiy tarif → `priceMonthly`.
 */
export function computeMonthlyPrice(tariff: Tariff, limits?: CustomLimits | null): number {
  if (!tariff.isCustom) {
    return tariff.priceMonthly;
  }
  const l: CustomLimits = limits ?? {
    branches: tariff.maxBranches,
    employees: tariff.maxEmployees,
    devices: tariff.maxDevices,
  };
  return (
    tariff.basePrice +
    l.branches * tariff.pricePerBranch +
    l.employees * tariff.pricePerEmployee +
    l.devices * tariff.pricePerDevice
  );
}
