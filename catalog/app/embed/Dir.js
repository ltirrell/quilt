import { basename } from 'path'

import dedent from 'dedent'
import * as R from 'ramda'
import * as React from 'react'
import * as M from '@material-ui/core'

import { copyWithoutSpaces, render as renderCrumbs } from 'components/BreadCrumbs'
import Message from 'components/Message'
import AsyncResult from 'utils/AsyncResult'
import * as AWS from 'utils/AWS'
import { useData } from 'utils/Data'
import * as NamedRoutes from 'utils/NamedRoutes'
import * as s3paths from 'utils/s3paths'
import usePrevious from 'utils/usePrevious'

import Code from 'containers/Bucket/Code'
import Listing, { ListingItem } from 'containers/Bucket/Listing'
import Summary from 'containers/Bucket/Summary'
import { displayError } from 'containers/Bucket/errors'
import * as requests from 'containers/Bucket/requests'

import * as EmbedConfig from './EmbedConfig'
import getCrumbs from './getCrumbs'

const formatListing = ({ urls, scope }, r) => {
  const dirs = r.dirs.map((name) =>
    ListingItem.Dir({
      name: s3paths.ensureNoSlash(s3paths.withoutPrefix(r.path, name)),
      to: urls.bucketDir(r.bucket, name),
    }),
  )
  const files = r.files.map(({ key, size, modified }) =>
    ListingItem.File({
      name: basename(key),
      to: urls.bucketFile(r.bucket, key),
      size,
      modified,
    }),
  )
  const items = [...dirs, ...files]
  if (r.path !== '' && r.path !== scope) {
    items.unshift(
      ListingItem.Dir({
        name: '..',
        to: urls.bucketDir(r.bucket, s3paths.up(r.path)),
      }),
    )
  }
  // filter-out files with same name as one of dirs
  return R.uniqBy(ListingItem.case({ Dir: R.prop('name'), File: R.prop('name') }), items)
}

const useStyles = M.makeStyles((t) => ({
  crumbs: {
    ...t.typography.body1,
    maxWidth: '100%',
    overflowWrap: 'break-word',
  },
}))

export default function Dir({
  match: {
    params: { bucket, path: encodedPath = '' },
  },
}) {
  const cfg = EmbedConfig.use()
  const classes = useStyles()
  const { urls } = NamedRoutes.use()
  const s3 = AWS.S3.use()
  const path = s3paths.decode(encodedPath)
  const dest = path ? basename(path) : bucket

  const code = React.useMemo(
    () => [
      {
        label: 'Python',
        hl: 'python',
        contents: dedent`
          import quilt3
          b = quilt3.Bucket("s3://${bucket}")
          # list files
          b.ls("${path}")
          # download
          b.fetch("${path}", "./${dest}")
        `,
      },
      {
        label: 'CLI',
        hl: 'bash',
        contents: dedent`
          # list files
          aws s3 ls "s3://${bucket}/${path}"
          # download
          aws s3 cp --recursive "s3://${bucket}/${path}" "./${dest}"
        `,
      },
    ],
    [bucket, path, dest],
  )

  const [prev, setPrev] = React.useState(null)
  const prevPath = usePrevious(path, () => {
    if (prevPath !== path) setPrev(null)
  })
  const data = useData(requests.bucketListing, {
    s3,
    bucket,
    path,
    prev: prevPath === path ? prev : null,
  })

  const loadMore = React.useCallback(() => {
    AsyncResult.case(
      {
        Ok: (res) => {
          if (res.continuationToken) setPrev(res)
        },
        _: () => {},
      },
      data.result,
    )
  }, [data.result])

  return (
    <M.Box pt={2} pb={4}>
      <M.Box display="flex" alignItems="flex-start" mb={2}>
        <div className={classes.crumbs} onCopy={copyWithoutSpaces}>
          {renderCrumbs(getCrumbs({ bucket, path, urls, scope: cfg.scope }))}
        </div>
        <M.Box flexGrow={1} />
      </M.Box>

      {!cfg.hideCode && <Code gutterBottom>{code}</Code>}

      {data.case({
        Err: displayError(),
        Init: () => null,
        _: (x) => {
          const res = AsyncResult.case(
            {
              Ok: R.identity,
              Pending: AsyncResult.case({
                Ok: R.identity,
                _: () => null,
              }),
              _: () => null,
            },
            x,
          )

          if (!res) return <M.CircularProgress />

          const items = formatListing({ urls, scope: cfg.scope }, res)

          if (!items.length) {
            return <Message headline="No files" />
          }

          const locked = !AsyncResult.Ok.is(x)

          return (
            <>
              <Listing
                items={items}
                truncated={res.truncated}
                locked={locked}
                loadMore={!!res.continuationToken && loadMore}
              />
              <Summary files={res.files} />
            </>
          )
        },
      })}
    </M.Box>
  )
}
