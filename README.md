# fba-cli: A CLI (command line interface) to execute FBA (fishbone analysis <img src="https://github.com/mbehr1/fishbone/blob/main/fishbone-icon2.png?raw=true" alt="icon" width="24">) files with DLT-logs/adlt 

## Summary

Executes fishbone-analysis files (fba) from the Visual Studio Code(tm) extension 'fishbone' [![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/mbehr1.fishbone.svg)](https://marketplace.visualstudio.com/items?itemName=mbehr1.fishbone) standalone - without vscode - on the console.

Execution performs:
- run all badges queries on a list of provided DLT logs
- generate a markdown report with any output from either the upper or the lower badge of all root causes.

### Other features

- Can be used to export embedded dlt-filters from the fishbone to be used with DLT-Viewer.

### How to use

Preconditions:
- Installed `adlt` and available in path. Check in terminal/console e.g. via `adlt --version`
- `node.js` v22 or higher installed. Check via `node --version`
- Install fba-cli via `npm install fba-cli -g`
- If adlt plugins shall be used a config file in json/jsonc/json5 format with
<details>
<summary>example json config file...</summary>

```jsonc
{
  "dlt-logs.plugins":[
    // all plugins from dlt-logs/adlt are supported
     { // e.g. NonVerbose plugin
      "name": "NonVerbose",
      "enabled": true,
      "fibexDir": "<...path to non-verbose fibex files...>",
    },
    {
      "name": "SomeIp",
      "enabled": true,
      "fibexDir": "<...path to someip fibex files...>"
    },
    {
      "name": "Rewrite",
      "enabled": true,
      "rewrites": [
        {
          "name": "SYS/JOUR timestamp",
          "filter": {
            "apid": "SYS",
            "ctid": "JOUR"
          },
          "payloadRegex": "^.*? .*? (?<timeStamp>\\d+\\.\\d+) (?<text>.*)$"
        }
      ]
    },
    {
      "name": "CAN",
      "enabled": true,
      "fibexDir": "<...path to can fibex files...",
    }
  ]
}
```
</details>


Call from terminal/console

```bash
# fba-cli exec -c <config_file> <list of fba files> <list of DLT files>
# e.g.
fba-cli exec -c config.json analysis.fba recorded.dlt recorded_p2.dlt > analysis_report.md
```
if you dont have adlt in path you can start it manually with the options
```sh
cd 'path where adlt binary is installed'
adlt remote -p 7777
```

and then use `fba-cli`:
```bash
# fba-cli exec -p host:port -c <config_file> <list of fba files> <list of DLT files>
# e.g.
fba-cli exec -p 127.0.0.1:7777 -c config.json analysis.fba recorded.dlt recorded_p2.dlt > analysis_report.md
```

### Hint for Windows Powershell users

Powershell seems to default to utf-16 and not utf-8. If you redirect the output to a file you do need to change the encoding first:

```powershell
$OutputEncoding = [Console]::InputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

# fba-cli exec -p host:port -c <config_file> <list of fba files> <list of DLT files>
# e.g.
npm.cmd run fba-cli exec -p 127.0.0.1:7777 -c config.json analysis.fba recorded.dlt recorded_p2.dlt > analysis_report.md
# seems that powershell doesnt allow the binary/scripts to be directly executed. In that case you can start via:
node dist\index.js exec -p 127.0.0.1:7777 -c config.json analysis.fba recorded.dlt > analysis_report.md
```

### Export filters in DLT-Viewer format:

```bash
# fba-cli export -f dlt-viewer <name of fba file> <name of zip file containing the .dlf filters>
fba-cli export -f dlt-viewer analysis.fba analysis_filters.zip
```


## Planned Features

* included messages from all badge queries that provided an output
- support graphical reports as well

## Known Issues

- embedded markdown background descriptions will not be properly formatted

## Contributions

Any and all test, code or feedback contributions are welcome.
Open an [issue](https://github.com/mbehr1/fba-cli/issues) or create a pull request to make this tool/lib work better for all.

[![Donations](https://www.paypalobjects.com/en_US/DK/i/btn/btn_donateCC_LG.gif)](https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=2ZNMJP5P43QQN&source=url) Donations are welcome!

## Third-party Content

This project leverages third party content. For details see the `dependencies` and `devDependencies` section in `package.json`.

Thanks to all contributors!
