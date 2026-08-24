import { describe, it, expect } from "vitest";
import { newHandleId, packUuid, unpackUuid, isHandleId, HANDLE_ID_LENGTH } from "@/lib/telegram/ids";

const UUIDS = [
  "00000000-0000-0000-0000-000000000000",
  "ffffffff-ffff-ffff-ffff-ffffffffffff",
  "3f1a2b3c-4d5e-4f60-8123-456789abcdef",
  "0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
];

describe("упаковка идентификаторов", () => {
  it("UUID укладывается в 22 символа и разворачивается обратно", () => {
    for (const uuid of UUIDS) {
      const packed = packUuid(uuid);
      expect(packed).toHaveLength(22);
      expect(Buffer.byteLength(packed, "utf8")).toBe(22);
      expect(unpackUuid(packed)).toBe(uuid);
    }
  });

  it("упаковка вдвое короче исходного UUID — ради неё всё и затевалось", () => {
    expect(packUuid(UUIDS[2]).length).toBeLessThan("3f1a2b3c-4d5e-4f60-8123-456789abcdef".length);
  });

  it("регистр в UUID не меняет упаковку", () => {
    expect(packUuid(UUIDS[2].toUpperCase())).toBe(packUuid(UUIDS[2]));
  });

  it("не-UUID бросает: такое в кнопку попасть не должно", () => {
    expect(() => packUuid("col-backlog")).toThrow();
    expect(() => packUuid("3f1a2b3c-4d5e-4f60-8123")).toThrow();
  });

  it("мусор в кнопке — null, а не исключение", () => {
    expect(unpackUuid("")).toBeNull();
    expect(unpackUuid("слишкомкороткий")).toBeNull();
    expect(unpackUuid("A".repeat(23))).toBeNull();
    expect(unpackUuid("!!!!!!!!!!!!!!!!!!!!!!")).toBeNull();
  });

  it("испорченный хвост упаковки отвергается, а не декодируется в ту же задачу", () => {
    /*
     * В 22 символах base64url 132 бита, значащих — 128. Последний символ несёт
     * два неиспользуемых бита, и Buffer их молча отбрасывает: без сверки
     * обратной упаковкой «...w» и «...x» дали бы один и тот же UUID, то есть
     * кнопка с испорченным хвостом продолжала бы работать как настоящая.
     */
    const packed = packUuid(UUIDS[2]);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

    const collisions = alphabet
      .split("")
      .map((char) => packed.slice(0, 21) + char)
      .filter((candidate) => candidate !== packed)
      .filter((candidate) => unpackUuid(candidate) === UUIDS[2]);

    expect(collisions).toEqual([]);
  });
});

describe("идентификаторы хендлов", () => {
  it("длина фиксирована и форма проверяется", () => {
    for (let i = 0; i < 50; i++) {
      const id = newHandleId();
      expect(id).toHaveLength(HANDLE_ID_LENGTH);
      expect(isHandleId(id)).toBe(true);
    }
  });

  it("не повторяется на коротком прогоне", () => {
    const ids = new Set(Array.from({ length: 500 }, () => newHandleId()));
    expect(ids.size).toBe(500);
  });

  it("чужая длина не проходит проверку формы", () => {
    expect(isHandleId("короткий")).toBe(false);
    expect(isHandleId("A".repeat(HANDLE_ID_LENGTH + 1))).toBe(false);
    expect(isHandleId("A".repeat(HANDLE_ID_LENGTH - 1))).toBe(false);
  });
});
