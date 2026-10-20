import { BusyBar } from '@busy-app/busy-lib';
import { describe, expect, it, vi } from 'vitest';

import { createBusyBar } from './client.ts';

vi.mock('@busy-app/busy-lib', () => ({ BusyBar: vi.fn<typeof BusyBar>() }));

describe('createBusyBar', () => {
  it('connects over USB without credentials', () => {
    createBusyBar({ addr: '10.0.4.20', token: undefined, isCloud: false });

    expect(BusyBar).toHaveBeenCalledExactlyOnceWith({ addr: '10.0.4.20' });
  });

  it('sends the token as the HTTP access password over Wi-Fi', () => {
    createBusyBar({ addr: '192.168.1.20', token: '1234', isCloud: false });

    expect(BusyBar).toHaveBeenCalledExactlyOnceWith({
      addr: '192.168.1.20',
      HTTPAccessPassword: '1234',
    });
  });

  it('sends the token as an API token to the cloud proxy', () => {
    createBusyBar({
      addr: 'https://api.busy.app',
      token: 'secret',
      isCloud: true,
    });

    expect(BusyBar).toHaveBeenCalledExactlyOnceWith({
      addr: 'https://api.busy.app',
      token: 'secret',
    });
  });
});
