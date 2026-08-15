import { describe, expect, it } from 'bun:test';

import { setXArticleCoverFileExactly } from '../../.agents/skills/baoyu-post-to-x/scripts/x-article';

type CdpHandler = (
  params: unknown,
  metadata: { sessionId?: string },
) => void;

function coverChooserCdp(nodeBelongsToScopedControl: boolean) {
  let chooserHandler: CdpHandler | undefined;
  let listenerRemoved = false;
  const interceptionStates: boolean[] = [];
  const assignedFiles: Array<{ backendNodeId: number; files: string[] }> = [];
  const cdp = {
    on(method: string, handler: CdpHandler) {
      if (method !== 'Page.fileChooserOpened') throw new Error(`Unexpected event: ${method}`);
      chooserHandler = handler;
      return () => {
        listenerRemoved = true;
        chooserHandler = undefined;
      };
    },
    async send<T>(method: string, params?: Record<string, unknown>): Promise<T> {
      if (method === 'Page.setInterceptFileChooserDialog') {
        interceptionStates.push(Boolean(params?.enabled));
        return {} as T;
      }
      if (method === 'Runtime.evaluate') {
        chooserHandler?.(
          { backendNodeId: 712, mode: 'selectSingle' },
          { sessionId: 'cover-session' },
        );
        return { result: { value: true } } as T;
      }
      if (method === 'DOM.resolveNode') {
        return { object: { objectId: 'cover-input-object' } } as T;
      }
      if (method === 'DOM.describeNode') {
        return {
          node: {
            backendNodeId: 712,
            nodeName: 'INPUT',
            attributes: ['type', 'file', 'accept', 'image/png,image/jpeg'],
          },
        } as T;
      }
      if (method === 'Runtime.callFunctionOn') {
        return { result: { value: nodeBelongsToScopedControl } } as T;
      }
      if (method === 'DOM.setFileInputFiles') {
        assignedFiles.push({
          backendNodeId: Number(params?.backendNodeId),
          files: [...(params?.files as string[])],
        });
        return {} as T;
      }
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  };
  return {
    cdp,
    interceptionStates,
    assignedFiles,
    listenerWasRemoved: () => listenerRemoved,
  };
}

describe('X Article cover file chooser', () => {
  it('rejects a same-session chooser that is not the scoped cover input', async () => {
    const fake = coverChooserCdp(false);

    await expect(setXArticleCoverFileExactly({
      cdp: fake.cdp as never,
      sessionId: 'cover-session',
      filePath: '/tmp/reviewed-cover.png',
    })).rejects.toThrow(/cover|chooser|scoped|input/i);

    expect(fake.assignedFiles).toEqual([]);
    expect(fake.interceptionStates).toEqual([true, false]);
    expect(fake.listenerWasRemoved()).toBe(true);
  });

  it('assigns the reviewed file only to the verified scoped cover input', async () => {
    const fake = coverChooserCdp(true);

    await expect(setXArticleCoverFileExactly({
      cdp: fake.cdp as never,
      sessionId: 'cover-session',
      filePath: '/tmp/reviewed-cover.png',
    })).resolves.toBeUndefined();

    expect(fake.assignedFiles).toEqual([{
      backendNodeId: 712,
      files: ['/tmp/reviewed-cover.png'],
    }]);
    expect(fake.interceptionStates).toEqual([true, false]);
    expect(fake.listenerWasRemoved()).toBe(true);
  });
});
