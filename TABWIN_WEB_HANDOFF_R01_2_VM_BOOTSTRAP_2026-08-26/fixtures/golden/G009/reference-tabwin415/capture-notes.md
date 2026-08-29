# G009 TabWin 4.15 blocked capture

The attempted recipe combined `RDAC2401.dbc` with `AIH_MA.DEF` to expose
`Permanência` through `PERM.CNV`. TabWin's directory chooser did not allow the
combination, as shown in `capture-blocker.png`.

Audit of the real DEF explains the behavior:

```text
;Movimento de AIH - Maranhão
AD:\MA\MA\MA*.DBC
...
TPermanência, DIAS_PERM, 2, PERM.CNV
```

The `A` directive restricts the source to the historical Maranhão path and
`MA*.DBC` mask. `RDAC2401.dbc` therefore cannot be selected under this DEF.
The earlier capture protocol was wrong and must not attribute this to the user.

Status: **blocked by incompatible oracle recipe; no golden table exists**.
