# 自用安装

本插件不发布到 npm Registry。开发机统一使用源码 `link:`；其他机器使用固定 GitHub Release 资产与 `SHA256SUMS`。

## 开发机

优先使用统一入口：

```powershell
cd D:\Software\GIT\dsh-webbridge
.\tools\link-dsh-web-suite.ps1 -Profile web
```

单独维护本仓库时：

```powershell
pnpm install --frozen-lockfile
pnpm run build
dsh plugin --profile web add link:D:/Software/GIT/dsh-vl-gateway
```

## 其他机器

优先使用 WebBridge Release 内的 `tools\install-dsh-web-suite.ps1`。单独安装固定 Release：

```powershell
$dir = Join-Path $env:TEMP 'dsh-deepseek-vision'
gh release download v0.1.9 --repo siegfly/dsh-deepseek-vision --pattern 'dsh-deepseek-vision-0.1.9.tgz' --pattern SHA256SUMS --dir $dir
dsh plugin --profile web add "file:$dir/dsh-deepseek-vision-0.1.9.tgz"
```

安装或改动源码后重启 `dsh web`。
