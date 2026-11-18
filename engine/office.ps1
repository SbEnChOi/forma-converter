param(
    [ValidateSet('Convert', 'Cleanup')][string]$Mode = 'Convert',
    [string]$RequestPath,
    [string]$ResponsePath,
    [Parameter(Mandatory = $true)][string]$ProcessPath
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Write-JsonFile($Path, $Value) {
    [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 8 -Compress), $utf8)
}

function Release-Com($Value) {
    if ($null -ne $Value -and [Runtime.InteropServices.Marshal]::IsComObject($Value)) {
        try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($Value) } catch {}
    }
}

function Write-Stage([string]$Value) {
    [IO.File]::WriteAllText($ProcessPath + '.stage', $Value, $utf8)
}

function Assert-NotCancelled {
    if (Test-Path -LiteralPath ($ProcessPath + '.cancel')) { throw 'FORMA_CANCELLED' }
}

if ($Mode -eq 'Cleanup') {
    if (Test-Path -LiteralPath $ProcessPath) {
        try {
            $meta = [IO.File]::ReadAllText($ProcessPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
            if ($meta.pid -gt 0) {
                $target = Get-Process -Id ([int]$meta.pid) -ErrorAction SilentlyContinue
                if ($null -ne $target -and $target.ProcessName -eq $meta.name -and
                    $target.StartTime.ToUniversalTime().Ticks.ToString() -eq $meta.startTimeTicks) {
                    if ($meta.ownsSession -eq $true -and $meta.preexistingPids -notcontains $meta.pid) {
                        Stop-Process -Id $target.Id -Force -ErrorAction SilentlyContinue
                    } elseif ($meta.ownsSession -eq $false -and $meta.source -and $meta.output -and $meta.progId) {
                        # Shared Office sessions must survive cancellation. Close only the unique temporary copy.
                        $sharedApp = $null
                        $sharedCollection = $null
                        try {
                            Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class FormaOfficeCleanupWindow {
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
}
'@
                            $sharedApp = [Runtime.InteropServices.Marshal]::GetActiveObject([string]$meta.progId)
                            $sharedPid = [uint32]0
                            [void][FormaOfficeCleanupWindow]::GetWindowThreadProcessId([IntPtr][long]$sharedApp.Hwnd, [ref]$sharedPid)
                            if ($sharedPid -eq $meta.pid) {
                                if ($meta.kind -eq 'word') { $sharedCollection = $sharedApp.Documents }
                                elseif ($meta.kind -eq 'excel') { $sharedCollection = $sharedApp.Workbooks }
                                elseif ($meta.kind -eq 'powerpoint') { $sharedCollection = $sharedApp.Presentations }
                                if ($null -ne $sharedCollection) {
                                    for ($index = $sharedCollection.Count; $index -ge 1; $index--) {
                                        $ownedCopy = $sharedCollection.Item($index)
                                        try {
                                            $copyPath = [IO.Path]::GetFullPath([string]$ownedCopy.FullName)
                                            if ($copyPath -eq $meta.source -or $copyPath -eq $meta.output) {
                                                if ($meta.kind -eq 'powerpoint') { $ownedCopy.Saved = -1; $ownedCopy.Close() }
                                                else { $ownedCopy.Close(0) }
                                            }
                                        } finally { Release-Com $ownedCopy }
                                    }
                                }
                            }
                        } finally { Release-Com $sharedCollection; Release-Com $sharedApp }
                    }
                }
            }
        } catch {}
    }
    exit 0
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class FormaOfficeWindow {
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
}
'@

function Get-AppProcess($App, $Name, $Before) {
    $resultId = [uint32]0
    try {
        $windowHandle = [IntPtr][long]$App.Hwnd
        [void][FormaOfficeWindow]::GetWindowThreadProcessId($windowHandle, [ref]$resultId)
    } catch {}
    if ($resultId -eq 0) {
        $newProcesses = @(Get-Process -Name $Name -ErrorAction SilentlyContinue | Where-Object { $Before -notcontains $_.Id })
        if ($newProcesses.Count -eq 1) { $resultId = $newProcesses[0].Id }
    }
    if ($resultId -eq 0) { return $null }
    return Get-Process -Id $resultId -ErrorAction SilentlyContinue
}

function Get-Pages($Specification, [int]$Count) {
    if ([string]::IsNullOrWhiteSpace([string]$Specification)) { return @(1..$Count) }
    $result = New-Object 'System.Collections.Generic.SortedSet[int]'
    foreach ($part in ([string]$Specification -split ',')) {
        if ($part.Trim() -notmatch '^(\d+)\s*(?:-\s*(\d+))?$') { throw '페이지 범위를 1-3, 5처럼 입력해 주세요.' }
        $first = [int]$Matches[1]
        $last = $first
        if ($Matches[2]) { $last = [int]$Matches[2] }
        if ($first -lt 1 -or $last -lt $first -or $last -gt $Count) { throw "페이지 범위는 1부터 $Count 사이로 입력해 주세요." }
        foreach ($number in $first..$last) { [void]$result.Add($number) }
    }
    return @($result)
}

$app = $null
$document = $null
$collection = $null
$ownsSession = $false
$savedAlerts = $null
$savedSecurity = $null
$kind = ''
$outputs = New-Object 'System.Collections.Generic.List[string]'
$warnings = New-Object 'System.Collections.Generic.List[string]'
$failure = $null
$diagnostic = $null

try {
    $request = [IO.File]::ReadAllText($RequestPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
    $source = [IO.Path]::GetFullPath([string]$request.source)
    $directory = [IO.Path]::GetFullPath([string]$request.directory)
    $format = ([string]$request.format).ToLowerInvariant()
    $extension = [IO.Path]::GetExtension($source).TrimStart('.').ToLowerInvariant()
    $stem = [string]$request.stem
    if (!(Test-Path -LiteralPath $source -PathType Leaf)) { throw '원본 파일을 찾을 수 없습니다.' }
    if (!(Test-Path -LiteralPath $directory -PathType Container)) { throw '변환 작업 폴더를 찾을 수 없습니다.' }
    if ([string]::IsNullOrWhiteSpace($stem) -or $stem.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0) { throw '출력 파일 이름이 올바르지 않습니다.' }
    # Join-Path returns provider-decorated strings; a typed variable strips that wrapper for Office COM.
    [string]$output = Join-Path $directory ($stem + '.' + $format)
    if ($source -eq $output -or (Test-Path -LiteralPath $output)) { throw '원본 또는 기존 파일을 덮어쓸 수 없습니다.' }

    if (@('doc', 'docx', 'rtf', 'odt', 'txt', 'pdf') -contains $extension) {
        if (@('pdf', 'docx', 'txt', 'html') -notcontains $format) { throw '이 문서의 출력 형식을 지원하지 않습니다.' }
        $kind = 'word'
        $processName = 'WINWORD'
        $progId = 'Word.Application'
    } elseif (@('xls', 'xlsx', 'csv') -contains $extension) {
        if (@('pdf', 'xlsx', 'csv') -notcontains $format) { throw '이 스프레드시트의 출력 형식을 지원하지 않습니다.' }
        $kind = 'excel'
        $processName = 'EXCEL'
        $progId = 'Excel.Application'
    } elseif (@('ppt', 'pptx') -contains $extension) {
        if (@('pdf', 'pptx', 'png', 'jpg') -notcontains $format) { throw '이 프레젠테이션의 출력 형식을 지원하지 않습니다.' }
        $kind = 'powerpoint'
        $processName = 'POWERPNT'
        $progId = 'PowerPoint.Application'
    } else { throw 'Office 변환에서 지원하지 않는 파일입니다.' }

    $before = @(Get-Process -Name $processName -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
    Write-JsonFile $ProcessPath @{ ownsSession = $false; pid = 0; name = $processName; preexistingPids = $before }
    Assert-NotCancelled
    Write-Stage 'starting'
    try { $app = New-Object -ComObject $progId } catch { throw "설치된 Microsoft Office의 $progId 프로그램을 시작할 수 없습니다. Office 설치와 첫 실행 설정을 확인해 주세요." }
    $appProcess = Get-AppProcess $app $processName $before
    if ($null -ne $appProcess) {
        $ownsSession = $before -notcontains $appProcess.Id
        Write-JsonFile $ProcessPath @{
            ownsSession = $ownsSession; pid = $appProcess.Id; name = $appProcess.ProcessName
            startTimeTicks = $appProcess.StartTime.ToUniversalTime().Ticks.ToString(); preexistingPids = $before
            source = $source; output = $output; kind = $kind; progId = $progId
        }
    }
    Assert-NotCancelled
    try { $savedAlerts = $app.DisplayAlerts } catch {}
    try { $savedSecurity = $app.AutomationSecurity; $app.AutomationSecurity = 3 } catch {}

    if ($kind -eq 'word') {
        if ($ownsSession) { $app.Visible = $false }
        $app.DisplayAlerts = 0
        $collection = $app.Documents
        Write-Stage 'opening-word'
        # Explicit passwords avoid an interactive password dialog. No registry or Word Options are changed.
        # Keep the call to the first nine arguments: optional tail signatures vary between Office type libraries.
        $document = $collection.Open($source, $false, $true, $false, 'FORMA_NO_PASSWORD', 'FORMA_NO_PASSWORD',
            $false, 'FORMA_NO_PASSWORD', 'FORMA_NO_PASSWORD')
        Assert-NotCancelled
        Write-Stage ('saving-word-' + $format)
        if ($format -eq 'pdf') {
            $document.ExportAsFixedFormat($output, 17, $false)
        } elseif ($format -eq 'docx') {
            $document.SaveAs2($output, 16)
            if ($extension -eq 'pdf') { $warnings.Add('PDF를 편집 가능한 문서로 재구성했습니다. 스캔 페이지와 복잡한 배치는 원본과 다를 수 있습니다.') }
        } elseif ($format -eq 'txt') {
            $content = $document.Content
            try { $text = ([string]$content.Text).Replace([string][char]7, '').Replace([string][char]1, '').Replace("`r", "`r`n") }
            finally { Release-Com $content }
            [IO.File]::WriteAllText($output, $text, $utf8)
            $warnings.Add('텍스트 형식에는 사진, 표의 배치와 글자 서식이 포함되지 않습니다.')
        } elseif ($format -eq 'html') {
            $webOptions = $document.WebOptions
            try { $webOptions.Encoding = 65001; $webOptions.OrganizeInFolder = $false; $webOptions.AllowPNG = $true } finally { Release-Com $webOptions }
            $document.SaveAs2($output, 10)
        }
        $outputs.Add($output)
    } elseif ($kind -eq 'excel') {
        if ($ownsSession) { $app.Visible = $false }
        $app.DisplayAlerts = $false
        $collection = $app.Workbooks
        # UpdateLinks=0 and ReadOnly=true. Encrypted inputs are rejected before COM startup.
        $document = $collection.Open($source, 0, $true)
        Assert-NotCancelled
        if ($format -eq 'pdf') {
            $document.ExportAsFixedFormat(0, $output, 0, $true, $false)
        } elseif ($format -eq 'xlsx') {
            $document.SaveAs($output, 51)
        } else {
            $worksheets = $document.Worksheets
            $sheet = $worksheets.Item(1)
            try { $sheet.Activate(); $document.SaveAs($output, 62) } finally { Release-Com $sheet; Release-Com $worksheets }
            $warnings.Add('CSV에는 첫 번째 시트의 값만 저장됩니다. 다른 시트와 글자 서식은 포함되지 않습니다.')
        }
        $outputs.Add($output)
    } else {
        $app.DisplayAlerts = 1
        $collection = $app.Presentations
        # ReadOnly=true, Untitled=false, WithWindow=false. Never hide a user's existing PowerPoint window.
        $document = $collection.Open($source, -1, 0, 0)
        Assert-NotCancelled
        if ($format -eq 'pdf') { $document.SaveAs($output, 32); $outputs.Add($output) }
        elseif ($format -eq 'pptx') { $document.SaveAs($output, 24); $outputs.Add($output) }
        else {
            $slides = $document.Slides
            $setup = $document.PageSetup
            try {
                $pages = @(Get-Pages $request.options.pages $slides.Count)
                $width = 1920
                $height = [int][Math]::Round($width * [double]$setup.SlideHeight / [double]$setup.SlideWidth)
                foreach ($number in $pages) {
                    $slide = $slides.Item($number)
                    [string]$slidePath = Join-Path $directory ('{0} - {1:000}.{2}' -f $stem, $number, $format)
                    try { $slide.Export($slidePath, $format.ToUpperInvariant(), $width, $height) } finally { Release-Com $slide }
                    $outputs.Add($slidePath)
                }
            } finally { Release-Com $setup; Release-Com $slides }
        }
    }
    foreach ($path in $outputs) {
        if (!(Test-Path -LiteralPath $path -PathType Leaf) -or (Get-Item -LiteralPath $path).Length -eq 0) { throw 'Office에서 변환 결과를 저장하지 못했습니다.' }
    }
    Assert-NotCancelled
    Write-Stage 'converted'
} catch {
    $failure = $_.Exception.Message
    $diagnostic = @{ line = $_.InvocationInfo.ScriptLineNumber; location = $_.InvocationInfo.PositionMessage; stack = $_.ScriptStackTrace; exception = $_.Exception.ToString() }
} finally {
    Write-Stage 'closing'
    if ($null -ne $document) {
        try {
            if ($kind -eq 'word' -or $kind -eq 'excel') { $document.Close(0) }
            else { $document.Close() }
        } catch {}
    }
    Release-Com $document
    Release-Com $collection
    if ($null -ne $app) {
        try { if ($null -ne $savedAlerts) { $app.DisplayAlerts = $savedAlerts } } catch {}
        try { if ($null -ne $savedSecurity) { $app.AutomationSecurity = $savedSecurity } } catch {}
        if ($ownsSession) {
            try {
                $remaining = 1
                if ($kind -eq 'word') { $remaining = $app.Documents.Count }
                elseif ($kind -eq 'excel') { $remaining = $app.Workbooks.Count }
                else { $remaining = $app.Presentations.Count }
                if ($remaining -eq 0) { $app.Quit() }
            } catch {}
        }
    }
    Release-Com $app
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
    if ($failure) { Write-JsonFile $ResponsePath @{ ok = $false; error = $failure; diagnostic = $diagnostic } }
    else { Write-JsonFile $ResponsePath @{ ok = $true; paths = @($outputs); warnings = @($warnings) } }
    Write-Stage 'finished'
}

if ($failure) { exit 1 }
